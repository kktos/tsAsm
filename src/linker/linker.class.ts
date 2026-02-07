import { EventEmitter } from "node:events";
import { ExpressionEvaluator } from "../assembler/expression";
import type { ValueHolder } from "../assembler/expression.types";
import { Parser } from "../assembler/parser.class";
import type { FileHandler, StreamState } from "../assembler/polyasm.types";
import { PASymbolTable } from "../assembler/symbol.class";
import type { DirectiveContext, DirectiveRuntime } from "../directives/directive.interface";
import { MacroHandler } from "../directives/macro/handler";
import { NullLister } from "../helpers/lister.class";
import type { Logger } from "../helpers/logger.class";
import { StreamManager } from "../helpers/stream-manager.class";
import type { FunctionHandler } from "../shared/functions/types";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { pushNumber } from "../utils/array.utils";
import { getHex } from "../utils/hex.util";
import { stringToASCIICharCodes } from "../utils/string.utils";
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
	public linkerSections: Segment[] = [];

	private modules: Map<string, Segment[]> = new Map();
	private emittedModules: Set<string> = new Set();
	public streamManager?: StreamManager;
	public currentModule: Segment[] = [];

	private finalSegment: Segment = { name: "", start: 0, size: Number.POSITIVE_INFINITY, data: [], resizable: true };
	public currentSegment: Segment = this.finalSegment;

	private isLittleEndian = true;

	public PC: ValueHolder;

	constructor(
		PC: number,
		private fileHandler?: FileHandler,
	) {
		this.PC = { value: PC };
		this.modules.set("__MAIN__", this.currentModule);
	}

	public addSegment(name: string, start: number, size: number, padValue = 0, resizable = false) {
		const seg = this.segments.find((s) => s.name === name);
		if (seg) throw new Error(`Segment already defined : ${name}`);

		// If size is zero, create an empty data array. If resizable is true, the segment will grow on writes.
		const newSeg: Segment = { name, start, size, data: size > 0 ? new Array(size).fill(padValue) : [], resizable, padValue, emitted: false };
		this.segments.push(newSeg);
	}

	public addLinkerSection(name: string, offset: number) {
		const seg = this.segments.find((s) => s.name === name);
		if (seg) throw new Error(`Segment already defined : ${name}`);

		const newSeg: Segment = { name, start: offset, size: 0, data: [] };
		this.linkerSections.push(newSeg);
		this.currentSegment = newSeg;
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

		this.currentSegment = seg;
		this.PC.value = seg.start;

		return seg.start;
	}

	public writeBytes(addr: number, values: number[]): void {
		const active = this.currentSegment;
		if (!active) throw new Error("Internal error: no active segment.");

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

	public rawBinaryLink(segments?: Segment[]): number[] {
		const segs = segments ?? this.segments;
		if (!segs || segs.length === 0) return [];

		let minStart = Number.POSITIVE_INFINITY;
		let maxEnd = Number.NEGATIVE_INFINITY;
		for (const s of segs) {
			minStart = Math.min(minStart, s.start);
			maxEnd = Math.max(maxEnd, s.start + s.size);
		}

		console.log("");
		console.log("Linker");

		// const outSize = maxEnd - minStart;
		// const out = new Array(outSize).fill(0);
		const out = [];
		let offset = 0;
		for (const s of segs) {
			// const offset = s.start - minStart;

			console.log("-", s.name, `offset: $${getHex(offset)}`, `addr: $${getHex(s.start)}`, `size: $${getHex(s.size)}`, `len: $${getHex(s.data.length)}`);

			const pad = s.padValue ?? 0;
			for (let i = 0; i < s.size; i++) {
				if (i < s.data.length) out[offset + i] = s.data[i] ?? pad;
				else out[offset + i] = pad;
			}

			offset += s.size;
		}
		return out;
	}

	public setEndianess(endianess: "little" | "big") {
		this.isLittleEndian = endianess === "little";
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

	public emitString(value: string, _offset?: number) {
		this.currentSegment.data.push(...stringToASCIICharCodes(value));
		this.PC.value += value.length;
	}
	public emitByte(value: number, offset?: number) {
		if (offset !== undefined) {
			this.currentSegment.data[offset] = value;
			return;
		}
		pushNumber(this.currentSegment.data, value, 8, this.isLittleEndian);
		this.PC.value += 1;
	}
	public emitWord(value: number, offset?: number) {
		if (offset !== undefined) {
			this.currentSegment.data[offset] = value;
			return;
		}
		pushNumber(this.currentSegment.data, value, 16, this.isLittleEndian);
		this.PC.value += 2;
	}
	public emitLong(value: number, offset?: number) {
		if (offset !== undefined) {
			this.currentSegment.data[offset] = value;
			return;
		}
		pushNumber(this.currentSegment.data, value, 32, this.isLittleEndian);
		this.PC.value += 4;
	}
	public emitBytes(value: number[], _offset?: number) {
		// if (offset !== undefined) {
		// 	this.finalObj[offset] = value;
		// 	return;
		// }
		this.currentSegment.data.push(...value);
		this.PC.value += value.length;
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
		const symbolTable = new PASymbolTable(lister);
		const parser = new Parser(new EventEmitter());
		if (this.fileHandler) this.streamManager = new StreamManager(this.fileHandler, parser);

		const evaluator = new ExpressionEvaluator(symbolTable, () => null, this.resolveSysValue.bind(this));

		const segHandler: FunctionHandler = (stack, token, _symbolTable, _argCount) => {
			const segName = stack.pop();
			if (typeof segName !== "string") throw new Error(`Argument to .SEGMENT() must be a string on line ${token.line}.`);
			const seg = this.segments.find((s) => s.name === segName);
			if (!seg) throw new Error(`Segment '${segName}' not found on line ${token.line}.`);
			stack.push(seg);
		};
		evaluator.functionDispatcher.register("SEGMENT", { handler: segHandler, minArgs: 1, maxArgs: 1 });

		const macroHandler = new MacroHandler(parser, symbolTable, lister);
		const runtime: DirectiveRuntime = {
			parser,
			symbolTable,
			evaluator,
			logger,
			lister,
			linker: this,
			macroHandler,
		};
		const dispatcher = new Dispatcher(runtime);

		this.currentSegment = this.finalSegment;
		this.PC.value = 0;
		if (outputPath) this.setOutputFile(outputPath);

		runtime.logger.log("--- Linker Begin---\n");

		parser.lexer.commentChar = "#";
		if (this.streamManager && this.fileHandler) {
			this.streamManager.start(script, this.fileHandler.fullpath, this.fileHandler.filename);
		} else {
			parser.start(script);
		}

		let currentLabel: string | undefined;

		while (parser.tokenStreamStack.length > 0) {
			const token = parser.next();
			// If no token or EOF, pop the active stream
			if (!token || token.type === "EOF") {
				const poppedStream = parser.popTokenStream(false);
				if (parser.tokenStreamStack.length === 0) break;
				if (poppedStream) parser.emitter.emit(`endOfStream:${poppedStream.id}`);
				continue;
			}

			switch (token.type) {
				case "DOT": {
					const directiveToken = parser.next() as ScalarToken;
					if (directiveToken?.type !== "IDENTIFIER") throw new Error(`Bad directive in line ${token.line} - ${directiveToken.value}`);

					const directiveContext: DirectiveContext = {
						filename: this.streamManager?.currentFilepath ?? "linker",
						isAssembling: true,
						PC: this.PC,
						currentLabel,
						macroArgs: (parser.tokenStreamStack[parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
						emitbytes: (bytes: number[]) => {
							this.emitBytes(bytes);
						},
						readSourceFile: this.fileHandler?.readSourceFile.bind(this.fileHandler),
					};
					if (!dispatcher.dispatch(directiveToken, directiveContext))
						throw new Error(`Syntax error in line ${token.line} - Unexpected directive '${directiveToken.value}'`);
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
							isAssembling: true,
							PC: this.PC,
							currentLabel,
							macroArgs: (parser.tokenStreamStack[parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
							emitbytes: (_bytes: number[]) => {},
						};
						if (!dispatcher.dispatch(token, directiveContext)) throw new Error(`Syntax error in line ${token.line} - Unexpected directive '${token.value}'`);
						break;
					}
					break;

				default:
					throw new Error(`Syntax error in line ${token.line} : ${token.type} ${token.value}`);
			}
		}

		if (!this.finalSegment.resizable && this.finalSegment.data.length) {
			const padding = new Array(this.finalSegment.size - this.finalSegment.data.length).fill(this.finalSegment.padValue ?? 0);
			this.finalSegment.data = this.finalSegment.data.concat(padding);
		}

		for (const section of this.linkerSections) this.finalSegment.data.splice(section.start, section.data.length, ...section.data);

		if (this.finalSegment.data.length > this.finalSegment.size)
			throw new Error(`Output file is too large. Max size is ${this.finalSegment.size} bytes, but the linker output is ${this.finalSegment.data.length} bytes`);

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
				throw new Error(`Unknown system variable: ${nameToken.value} on line ${nameToken.line}.`);
		}
	}
}
