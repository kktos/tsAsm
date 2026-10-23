import { EventEmitter } from "node:events";
import { ExpressionEvaluator } from "../assembler/expression";
import type { ValueHolder } from "../assembler/expression.types";
import { Parser } from "../assembler/parser.class";
import type { FileHandler, StreamState } from "../assembler/polyasm.types";
import { PASymbolTable } from "../assembler/symbol.class";
import type { Endianness } from "../cpu/cpuhandler.interface";
import type { DirectiveContext, DirectiveRuntime } from "../directives/directive.interface";
import { MacroHandler } from "../directives/macro/handler";
import { ErrorLocator } from "../helpers/error-locator.class";
import { NullLister } from "../helpers/lister.class";
import type { Logger } from "../helpers/logger.class";
import { StreamManager } from "../helpers/stream-manager.class";
import type { FunctionHandler } from "../shared/functions/types";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { pushNumber } from "../utils/array.utils";
import { AsmError } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";
import { stringToBytes } from "../utils/string.utils";
import { Dispatcher } from "./directives/dispatcher.class";

export interface Segment {
	name: string;
	start: number;
	size: number;
	data: number[];
	/** Whether this segment may grow when writes go past its declared size. Default: false (fixed). */
	resizable?: boolean;
	/** Value used to pad the segment to its declared size when linking. Default: 0. */
	padValue?: number;
	/** Whether this segment has been emitted to the final image. */
	emitted?: boolean;
}

export class Linker {
	public segments: Segment[] = [];
	/** What the script writes at an offset (a .SECTION … AT, a .WRITE … AT): applied in order over the complete output. */
	public linkerSections: Segment[] = [];

	private modules: Map<string, Segment[]> = new Map();
	private emittedModules: Set<string> = new Set();
	public streamManager?: StreamManager;
	public currentModule: Segment[] = [];

	private finalSegment: Segment = { name: "", start: 0, size: Number.POSITIVE_INFINITY, data: [], resizable: true };
	/** The segment being written to: none until useSegment() (or link(), which selects the output image). */
	public currentSegment: Segment | undefined;
	/** Where each segment's code continues when it's selected again. */
	private resumePC = new Map<Segment, number>();

	private isLittleEndian = true;

	public PC: ValueHolder;

	constructor(
		private readonly startPC: number,
		private fileHandler?: FileHandler,
	) {
		this.PC = { value: startPC };
		this.modules.set("__MAIN__", this.currentModule);
	}

	/** Back to the state after construction: no segments, sections or modules, an empty output. Keeps the same PC object. */
	public reset() {
		this.segments = [];
		this.linkerSections = [];
		this.currentModule = [];
		this.modules = new Map([["__MAIN__", this.currentModule]]);
		this.emittedModules = new Set();
		this.finalSegment = { name: "", start: 0, size: Number.POSITIVE_INFINITY, data: [], resizable: true };
		this.currentSegment = undefined;
		this.resumePC.clear();
		this.isLittleEndian = true;
		this.PC.value = this.startPC;
	}

	public addSegment(name: string, start: number, size: number, padValue = 0, resizable = false) {
		const seg = this.segments.find((s) => s.name === name);
		if (seg) throw new Error(`Segment already defined : ${name}`);

		// If size is zero, create an empty data array. If resizable is true, the segment will grow on writes.
		const newSeg: Segment = { name, start, size, data: size > 0 ? new Array(size).fill(padValue) : [], resizable, padValue, emitted: false };
		this.segments.push(newSeg);
	}

	/** What follows is written at `offset` of the output: `.PC` is the offset where the next byte goes. */
	public addLinkerSection(name: string, offset: number) {
		const seg = this.segments.find((s) => s.name === name);
		if (seg) throw new Error(`Segment already defined : ${name}`);
		checkOffset(offset);

		const newSeg: Segment = { name, start: offset, size: 0, data: [] };
		this.linkerSections.push(newSeg);
		this.currentSegment = newSeg;
		this.PC.value = offset;
	}

	public addInlineSection(_name: string) {
		this.currentSegment = this.finalSegment;
		this.PC.value = this.finalSegment.data.length;
	}

	public addModule(name: string) {
		let module = this.modules.get("__MAIN__");
		if (module) {
			if (this.currentModule.length) throw new Error("Segments were used before any module was defined.");
			this.modules.delete("__MAIN__");
		}

		module = this.modules.get(name);
		if (module) throw new Error(`Module already defined: ${name}`);
		this.currentModule = [];
		this.modules.set(name, this.currentModule);
	}

	public useModule(name: string) {
		const module = this.modules.get(name);
		if (!module) throw new Error(`Module not found: ${name}`);

		this.currentModule = module;
	}

	public resetModules() {
		const keys = [...this.modules.keys()];
		this.modules.clear();
		// biome-ignore lint/suspicious/useIterableCallbackReturn: <ok>
		keys.forEach((k) => this.modules.set(k, []));
	}

	/** Selects a segment by name and makes it the active segment for subsequent writes. */
	public useSegment(name: string) {
		const seg = this.segments.find((s) => s.name === name);
		if (!seg) throw new Error(`Segment not found: ${name}`);

		if (!this.currentModule) throw new Error(`No Module defined for segment: ${name}`);

		// if (this.currentModule.find((s) => s.name === name)) throw new Error(`Segment already used in module: ${name}`);
		if (!this.currentModule.find((s) => s.name === name)) this.currentModule.push(seg);

		// Leaving a segment: remember where its code continues. Selecting it again resumes there, as other assemblers do.
		if (this.currentSegment) this.resumePC.set(this.currentSegment, this.PC.value);

		this.currentSegment = seg;
		this.PC.value = this.resumePC.get(seg) ?? seg.start;

		return this.PC.value;
	}

	/** At the start of each pass, every segment starts again from its start address. */
	public resetSegmentPositions() {
		this.resumePC.clear();
	}

	public writeBytes(addr: number, values: number[]): void {
		const active = this.currentSegment;
		if (!active) throw new Error(`No active segment for the bytes at $${getHex(addr)}: select a segment with .SEGMENT before emitting code or data.`);

		const offset = addr - active.start;
		if (offset < 0)
			throw new Error(
				`Write out of bounds: address $${addr.toString(16).toUpperCase()} is below segment '${active.name}' start $${active.start.toString(16).toUpperCase()}.`,
			);

		if (offset >= active.size && !active.resizable)
			throw new Error(
				`Write out of bounds: address $${addr.toString(16).toUpperCase()} outside fixed segment '${active.name}' (start $${active.start.toString(16).toUpperCase()}, size ${active.size}).`,
			);

		if (offset >= active.data.length) {
			if (!active.resizable) throw new Error(`Internal error: segment '${active.name}' data shorter than declared size and not resizable.`);

			const needed = offset + values.length - active.data.length;
			active.data.push(...new Array(needed).fill(active.padValue ?? 0));
		}

		// active.data[offset] = value & 0xff;
		active.data.splice(offset, values.length, ...values);
		if (active.resizable && active.size < active.data.length) active.size = active.data.length;
	}

	/**
	 * Links the segments into a flat binary, each one at its address relative to the lowest one.
	 * Gaps between segments are filled with 0; where segments overlap, the later one wins.
	 * Empty segments are ignored. With a logger, each segment's place in the binary is logged.
	 */
	public rawBinaryLink(segments?: Segment[], logger?: Logger): number[] {
		const segs = (segments ?? this.segments).filter((s) => s.size > 0);
		if (segs.length === 0) return [];

		const minStart = Math.min(...segs.map((s) => s.start));
		const maxEnd = Math.max(...segs.map((s) => s.start + s.size));

		logger?.log("\n--- Linker ---");

		const out: number[] = new Array(maxEnd - minStart).fill(0);
		for (const s of segs) {
			const offset = s.start - minStart;

			logger?.log(`- ${s.name} offset: $${getHex(offset)} addr: $${getHex(s.start)} size: $${getHex(s.size)} len: $${getHex(s.data.length)}`);

			const pad = s.padValue ?? 0;
			for (let i = 0; i < s.size; i++) {
				if (i < s.data.length) out[offset + i] = s.data[i] ?? pad;
				else out[offset + i] = pad;
			}
		}
		return out;
	}

	public setEndianess(endianess: "little" | "big") {
		this.isLittleEndian = endianess === "little";
	}

	/** The byte order set by the linker script's .ENDIAN. Default: little. */
	public get endianness(): Endianness {
		return this.isLittleEndian ? "little" : "big";
	}

	public setOutputFile(filename: string, fixedSize?: number, padValue?: number, maxSize?: number) {
		this.finalSegment.name = filename;
		if (fixedSize !== undefined) {
			this.finalSegment.size = fixedSize;
			this.finalSegment.padValue = padValue;
			this.finalSegment.resizable = false;
		}
		if (maxSize !== undefined) this.finalSegment.size = maxSize;
	}

	/** The segment the linker script writes to. */
	private activeSegment(): Segment {
		if (!this.currentSegment) throw new Error("Internal error: no active segment.");
		return this.currentSegment;
	}

	/**
	 * Writes the bytes after what was written last, in the output or the section. At `offset` of the output instead,
	 * over it once it is complete, without moving `.PC`.
	 */
	private write(bytes: number[], offset?: number) {
		if (offset !== undefined) {
			checkOffset(offset);
			this.linkerSections.push({ name: "", start: offset, size: 0, data: bytes });
			return;
		}
		this.activeSegment().data.push(...bytes);
		this.PC.value += bytes.length;
	}

	private writeNumber(value: number, bits: 8 | 16 | 32, offset?: number) {
		const bytes: number[] = [];
		pushNumber(bytes, value, bits, this.isLittleEndian);
		this.write(bytes, offset);
	}

	public emitString(value: string, offset?: number) {
		this.write(stringToBytes(value, "Invalid write string directive -"), offset);
	}
	public emitByte(value: number, offset?: number) {
		this.writeNumber(value, 8, offset);
	}
	public emitWord(value: number, offset?: number) {
		this.writeNumber(value, 16, offset);
	}
	public emitLong(value: number, offset?: number) {
		this.writeNumber(value, 32, offset);
	}
	public emitBytes(value: number[], offset?: number) {
		this.write(value, offset);
	}

	public emitSegment(name: string, _offset?: number) {
		// if (offset !== undefined) {
		// 	this.finalObj[offset] = value;
		// 	return;
		// }

		const seg = this.segments.find((s) => s.name === name);
		if (!seg) throw new Error(`Segment not found: ${name}`);

		const startOffset = this.finalSegment.data.length;
		this.finalSegment.data.push(...seg.data);
		if (!seg.resizable) this.finalSegment.data.push(...new Array(seg.size - seg.data.length).fill(seg.padValue ?? 0));
		this.PC.value += this.finalSegment.data.length - startOffset;
		seg.emitted = true;
	}

	public emitModule(name: string, _offset?: number) {
		const module = this.modules.get(name);
		if (!module) throw new Error(`Module not found: ${name}`);

		for (const segment of module) this.emitSegment(segment.name);
		this.emittedModules.add(name);
	}

	public link(script: string, outputPath: string | undefined, logger: Logger) {
		const lister = new NullLister();
		const symbolTable = new PASymbolTable(lister, () => this.streamManager?.includeStack ?? []);
		const parser = new Parser(new EventEmitter());
		if (this.fileHandler) this.streamManager = new StreamManager(this.fileHandler, parser);

		const evaluator = new ExpressionEvaluator(symbolTable, () => null, this.resolveSysValue.bind(this));

		const segHandler: FunctionHandler = (stack, token, _symbolTable, _argCount) => {
			const segName = stack.pop();
			if (typeof segName !== "string") throw AsmError.at("Argument to .SEGMENT() must be a string.", token);
			const seg = this.segments.find((s) => s.name === segName);
			if (!seg) throw AsmError.at(`Segment '${segName}' not found.`, token);
			stack.push(seg);
		};
		evaluator.functionDispatcher.register("SEGMENT", { handler: segHandler, minArgs: 1, maxArgs: 1 });

		const macroHandler = new MacroHandler(parser, symbolTable, lister);
		/** The first token of the statement being linked: where its errors are located. */
		let statementToken: Token | undefined;
		const errorLocator = new ErrorLocator(parser, macroHandler, () => statementToken, this.streamManager);
		const runtime: DirectiveRuntime = {
			parser,
			symbolTable,
			evaluator,
			logger,
			lister,
			linker: this,
			macroHandler,
			warn: (message, position) => logger.warn(errorLocator.warning(message, position)),
			includeStack: () => this.streamManager?.includeStack ?? [],
		};
		const dispatcher = new Dispatcher(runtime);

		this.currentSegment = this.finalSegment;
		this.PC.value = 0;
		if (outputPath) this.setOutputFile(outputPath);

		runtime.logger.log("--- Linker Begin ---\n");

		parser.lexer.commentChar = "#";
		if (this.streamManager && this.fileHandler) {
			this.streamManager.start(script, this.fileHandler.fullpath, this.fileHandler.filename);
		} else {
			parser.start(script);
		}

		let currentLabel: string | undefined;

		try {
			while (parser.tokenStreamStack.length > 0) {
				const token = parser.next();
				// If no token or EOF, pop the active stream
				if (!token || token.type === "EOF") {
					const poppedStream = parser.popTokenStream(false);
					if (parser.tokenStreamStack.length === 0) break;
					if (poppedStream) parser.emitter.emit(`endOfStream:${poppedStream.id}`);
					continue;
				}
				// `name = value` is one statement, from its name.
				const isAssignment = token.type === "OPERATOR" && token.value === "=" && statementToken?.type === "IDENTIFIER" && statementToken.line === token.line;
				if (!isAssignment) statementToken = token;

				switch (token.type) {
					case "DOT": {
						const directiveToken = parser.next() as ScalarToken;
						if (directiveToken?.type !== "IDENTIFIER") throw AsmError.at(`Expected a directive name after '.', got '${directiveToken.value}'.`, directiveToken);

						const directiveContext: DirectiveContext = {
							filename: this.streamManager?.currentFilepath ?? "linker",
							PC: this.PC,
							currentLabel,
							macroArgs: (parser.tokenStreamStack[parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
							emitbytes: (bytes: number[]) => {
								this.emitBytes(bytes);
							},
							readSourceFile: this.fileHandler?.readSourceFile.bind(this.fileHandler),
						};
						if (!dispatcher.dispatch(directiveToken, directiveContext))
							throw AsmError.at(`Syntax error - Unexpected directive '${directiveToken.value}'`, directiveToken);
						break;
					}
					case "IDENTIFIER":
						if (runtime.macroHandler.isMacro(token.value)) {
							runtime.macroHandler.expandMacro(token);
							break;
						}
						currentLabel = token.value;
						break;

					case "OPERATOR":
						if (token.value === "=" && currentLabel) {
							const directiveContext: DirectiveContext = {
								filename: this.streamManager?.currentFilepath ?? "linker",
								PC: this.PC,
								currentLabel,
								macroArgs: (parser.tokenStreamStack[parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
								emitbytes: (_bytes: number[]) => {},
							};
							if (!dispatcher.dispatch(token, directiveContext)) throw AsmError.at(`Syntax error - Unexpected directive '${token.value}'`, token);
							break;
						}
						break;

					default:
						throw AsmError.at(`Syntax error - Unexpected ${token.type} '${token.value}'`, token);
				}
			}

			// What follows is about the whole output, not a statement.
			statementToken = undefined;

			const output = this.finalSegment.data;
			const pad = this.finalSegment.padValue ?? 0;
			// Up to its FIXED size, then up to each section past its end.
			if (!this.finalSegment.resizable) padTo(output, this.finalSegment.size, pad);
			for (const section of this.linkerSections) {
				padTo(output, section.start, pad);
				output.splice(section.start, section.data.length, ...section.data);
			}

			if (this.finalSegment.data.length > this.finalSegment.size)
				throw new Error(
					`Output file is too large. Max size is ${this.finalSegment.size} bytes, but the linker output is ${this.finalSegment.data.length} bytes`,
				);
		} catch (e) {
			throw errorLocator.toAsmError(e);
		}

		runtime.logger.log(`\nOUTPUT FILE: ${this.finalSegment.name}`);
		runtime.logger.log("\n--- Linker End ---");

		return this.finalSegment;
	}
	private resolveSysValue(nameToken: Token) {
		switch (nameToken.value) {
			case "PC":
				return this.PC.value;

			case "SEGMENT":
				return this.currentSegment;

			case "FILENAME":
				return this.streamManager?.currentFilename ?? this.finalSegment.name;

			case "IMAGE_END":
				return this.finalSegment.resizable ? this.finalSegment.data.length : this.finalSegment.size;

			case "MODULES_LIST": {
				const modulesHybrid = [];
				for (const [name, segments] of this.modules.entries()) {
					const size = segments.reduce((acc, seg) => acc + seg.size, 0);
					modulesHybrid.push({ name, segments, size });
				}
				return modulesHybrid;
			}

			case "SEGMENTS_LIST": {
				return this.segments;
			}

			case "UNWRITTEN_SEGMENTS":
				return this.segments.filter((s) => !s.emitted);

			case "UNWRITTEN_MODULES": {
				const unwrittenModules = [];
				for (const [name, segments] of this.modules.entries()) {
					if (this.emittedModules.has(name)) continue;
					const size = segments.reduce((acc, seg) => acc + seg.size, 0);
					unwrittenModules.push({ name, segments, size });
				}
				return unwrittenModules;
			}

			default:
				throw AsmError.at(`Unknown system variable: ${nameToken.value}.`, nameToken);
		}
	}
}

function checkOffset(offset: number) {
	if (offset < 0) throw new Error(`Invalid offset ${offset}: it can't be negative.`);
}

/** Pads `data` with `value` up to `length`, if it's shorter. */
function padTo(data: number[], length: number, value: number) {
	while (data.length < length) data.push(value);
}
