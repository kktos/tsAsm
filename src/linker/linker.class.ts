import { EventEmitter } from "node:events";
import { ExpressionEvaluator } from "../assembler/expression";
import type { ValueHolder } from "../assembler/expression.types";
import { DEFAULT_OPTIONS } from "../assembler/options";
import { Parser } from "../assembler/parser.class";
import type { FileHandler, StreamState } from "../assembler/polyasm.types";
import type { RelocValue } from "../assembler/reloc-value.class";
import { PASymbolTable, type SymbolValue } from "../assembler/symbol.class";
import type { Endianness } from "../cpu/cpuhandler.interface";
import type { DirectiveContext, DirectiveRuntime } from "../directives/directive.interface";
import { MacroHandler } from "../directives/macro/handler";
import { ErrorLocator } from "../helpers/error-locator.class";
import { NullLister } from "../helpers/lister.class";
import type { Logger } from "../helpers/logger.class";
import { StreamManager } from "../helpers/stream-manager.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { pushNumber } from "../utils/array.utils";
import { AsmError, type DefinitionSite } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";
import { stringToBytes } from "../utils/string.utils";
import { Dispatcher } from "./directives/dispatcher.class";

/** A relocatable value written in a segment: when it's loaded, the address of the value's segment is added there. */
export interface Fixup {
	/** Where its bytes start, from the start of the segment holding them. */
	offset: number;
	/** How many bytes: 1 to 4. */
	size: number;
	/** How many bits the address is shifted right before its `size` bytes are written: 0, 8 for `>`, 16 for `^`. */
	shift: number;
	/** The segment the value is in. */
	segment: string;
	/** The value's offset in that segment. */
	targetOffset: number;
}

/** A segment's attributes: the keys of its definition the assembler doesn't know, in lowercase, for the linker script. */
export type SegmentAttributes = Record<string, number | string>;

export interface Segment {
	name: string;
	start: number;
	size: number;
	data: number[];
	/** Whether this segment may grow when writes go past its declared size. Default: false (fixed). */
	resizable?: boolean;
	/** Value used to pad the segment to its declared size when linking. Default: 0. */
	padValue?: number;
	/** Whether this segment has no address until it's loaded: its `start` is 0. Default: false. */
	relocatable?: boolean;
	/** Whether this segment has been emitted to the final image. */
	emitted?: boolean;
	/** The relocatable values written in it, recorded in pass 2. */
	relocs?: Fixup[];
	/** Its attributes, which only the linker script reads (`seg.attrs.kind`). */
	attrs?: SegmentAttributes;
}

/** What a segment is defined with: any field left out is 0, false or no attributes. */
export type SegmentParams = Partial<Pick<Segment, "start" | "size" | "padValue" | "resizable" | "relocatable" | "attrs">>;

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
		/** The assembled source's symbols, global or `ns::name`, that the script reads with `.symbol()`. */
		private readonly findSourceSymbol?: (name: string) => SymbolValue | undefined,
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

	public findSegment(name: string): Segment | undefined {
		return this.segments.find((s) => s.name === name);
	}

	/** A segment: from `start`, `size` bytes of `padValue`, growing on writes when `resizable`. */
	public addSegment(name: string, { start = 0, size = 0, padValue = 0, resizable = false, relocatable = false, attrs = {} }: SegmentParams = {}) {
		const seg = this.findSegment(name);
		if (seg) throw new Error(`Segment already defined : ${name}`);

		// If size is zero, create an empty data array. If resizable is true, the segment will grow on writes.
		const newSeg: Segment = {
			name,
			start,
			size,
			data: size > 0 ? Array.from({ length: size }, () => padValue) : [],
			resizable,
			padValue,
			relocatable,
			emitted: false,
			relocs: [],
			attrs,
		};
		this.segments.push(newSeg);
	}

	/** What follows is written at `offset` of the output: `.PC` is the offset where the next byte goes. */
	public addLinkerSection(name: string, offset: number) {
		const seg = this.findSegment(name);
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
		const seg = this.findSegment(name);
		if (!seg) throw new Error(`Segment not found: ${name}`);

		if (!this.currentModule) throw new Error(`No Module defined for segment: ${name}`);

		if (!this.currentModule.find((s) => s.name === name)) this.currentModule.push(seg);

		// Leaving a segment: remember where its code continues. Selecting it again resumes there, as other assemblers do.
		if (this.currentSegment) this.resumePC.set(this.currentSegment, this.PC.value);

		this.currentSegment = seg;
		this.PC.value = this.resumePC.get(seg) ?? seg.start;

		return this.PC.value;
	}

	/** `.org` and `* =` set an address: a relocatable segment has none until it's loaded. */
	public checkOrg() {
		if (this.currentSegment?.relocatable)
			throw new Error(`Segment '${this.currentSegment.name}' is relocatable: it has no address until it's loaded, so .ORG and * = can't set one.`);
	}

	/** At the start of each pass, every segment starts again from its start address, without fixups. */
	public resetSegmentPositions() {
		this.resumePC.clear();
		for (const segment of this.segments) segment.relocs = [];
	}

	/** Records the fixup of the relocatable `value`, written in `size` bytes at `addr` of the current segment. */
	public addFixup(addr: number, size: number, value: RelocValue) {
		const active = this.currentSegment;
		if (!active) throw new Error(`No active segment for the bytes at $${getHex(addr)}: select a segment with .SEGMENT before emitting code or data.`);
		active.relocs ??= [];
		active.relocs.push({ offset: addr - active.start, size, shift: value.byteShift ?? 0, segment: value.segment, targetOffset: value.offset });
	}

	public writeBytes(addr: number, values: number[]): void {
		const active = this.currentSegment;
		if (!active) throw new Error(`No active segment for the bytes at $${getHex(addr)}: select a segment with .SEGMENT before emitting code or data.`);

		const offset = addr - active.start;
		if (offset < 0)
			throw new Error(
				`Write out of bounds: address $${addr.toString(16).toUpperCase()} is below segment '${active.name}' start $${active.start.toString(16).toUpperCase()}.`,
			);

		// The whole write must fit: the first address past the end is the one reported.
		if ((offset >= active.size || offset + values.length > active.size) && !active.resizable) {
			const outside = active.start + Math.max(offset, active.size);
			throw new Error(
				`Write out of bounds: address $${outside.toString(16).toUpperCase()} outside fixed segment '${active.name}' (start $${active.start.toString(16).toUpperCase()}, size ${active.size}).`,
			);
		}

		if (offset >= active.data.length) {
			if (!active.resizable) throw new Error(`Internal error: segment '${active.name}' data shorter than declared size and not resizable.`);

			const needed = offset + values.length - active.data.length;
			active.data.push(...Array.from({ length: needed }, () => active.padValue ?? 0));
		}

		// active.data[offset] = value & 0xff;
		active.data.splice(offset, values.length, ...values);
		if (active.resizable && active.size < active.data.length) active.size = active.data.length;
	}

	/**
	 * Links the segments into a flat binary, each one at its address relative to the lowest one.
	 * Gaps between segments are filled with 0; where segments overlap, the later one wins.
	 * Empty segments are ignored. With a logger, each segment's place in the binary is logged. A relocatable segment
	 * has no address: only a linker script can place it.
	 */
	public rawBinaryLink(segments?: Segment[], logger?: Logger): number[] {
		const segs = (segments ?? this.segments).filter((s) => s.size > 0);
		if (segs.length === 0) return [];
		const relocatable = segs.find((s) => s.relocatable);
		if (relocatable) throw new Error(`Segment '${relocatable.name}' is relocatable: it needs a linker script to place it.`);

		const minStart = Math.min(...segs.map((s) => s.start));
		const maxEnd = Math.max(...segs.map((s) => s.start + s.size));

		logger?.log("\n--- Linker ---");

		const out: number[] = Array.from({ length: maxEnd - minStart }, () => 0);
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

	public emitSegment(name: string, offset?: number) {
		const seg = this.findSegment(name);
		if (!seg) throw new Error(`Segment not found: ${name}`);

		this.write(segmentBytes(seg), offset);
		seg.emitted = true;
	}

	/** Every segment of the module, one after the other, in the order they were first used. */
	public emitModule(name: string, offset?: number) {
		const module = this.modules.get(name);
		if (!module) throw new Error(`Module not found: ${name}`);

		this.write(module.flatMap(segmentBytes), offset);
		for (const segment of module) segment.emitted = true;
		this.emittedModules.add(name);
	}

	public link(script: string, outputPath: string | undefined, logger: Logger) {
		const lister = new NullLister();
		const symbolTable = new PASymbolTable(lister, (source): DefinitionSite => errorLocator.definitionSite(source));
		const parser = new Parser(new EventEmitter());
		if (this.fileHandler) this.streamManager = new StreamManager(this.fileHandler, parser);

		const macroHandler = new MacroHandler(parser, symbolTable, lister);
		const evaluator = new ExpressionEvaluator(symbolTable, {
			resolveSysValue: (nameToken) => this.resolveSysValue(nameToken),
			findSegment: (name) => this.findSegment(name),
			findSourceSymbol: (name) => this.findSourceSymbol?.(name),
			isMacroDefined: (name) => macroHandler.isDefined(name),
		});

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
			// A link script has no .option
			option: (name) => DEFAULT_OPTIONS[name],
			warn: (message, position) => logger.warn(errorLocator.warning(message, position)),
			currentStatement: () => statementToken,
			definitionSite: (position) => errorLocator.definitionSite(position),
			includeSites: (position) => errorLocator.includeSites(position),
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
				const isAssignment =
					token.type === "OPERATOR" && token.value === "=" && statementToken?.type === "IDENTIFIER" && statementToken.line === token.line;
				if (!isAssignment) statementToken = token;

				switch (token.type) {
					case "DOT": {
						const directiveToken = parser.next() as ScalarToken;
						if (directiveToken?.type !== "IDENTIFIER")
							throw AsmError.at(`Expected a directive name after '.', got '${directiveToken.value}'.`, directiveToken);

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

/** A segment's bytes: a fixed segment is padded to its size. */
function segmentBytes(segment: Segment): number[] {
	const bytes = [...segment.data];
	if (!segment.resizable) padTo(bytes, segment.size, segment.padValue ?? 0);
	return bytes;
}

function checkOffset(offset: number) {
	if (offset < 0) throw new Error(`Invalid offset ${offset}: it can't be negative.`);
}

/** Pads `data` with `value` up to `length`, if it's shorter. */
function padTo(data: number[], length: number, value: number) {
	while (data.length < length) data.push(value);
}
