import type { ValueHolder } from "../assembler/expression.types";
import type { Parser } from "../assembler/parser.class";
import type { Assembler } from "../assembler/polyasm";
import type { DirectiveContext, DirectiveRuntime } from "../directives/directive.interface";
import type { Logger } from "../helpers/logger.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
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
}

type TOutputFile = {
	filename: string;
	size?: number;
	maxSize?: number;
};

export class Linker {
	public segments: Segment[] = [];
	public currentSegment?: Segment;

	private finalObj: number[] = [];
	private outputFile: TOutputFile = { filename: "" };
	private endianess: 1 | -1 = 1;
	private assembler: Assembler | undefined;

	public PC: ValueHolder = { value: 0 };

	constructor(private logger?: Logger) {}

	public addSegment(name: string, start: number, size: number, padValue = 0, resizable = false): void {
		const seg = this.segments.find((s) => s.name === name);
		if (seg) throw new Error(`Segment already defined : ${name}`);

		// If size is zero, create an empty data array. If resizable is true, the segment will grow on writes.
		const newSeg: Segment = { name, start, size, data: size > 0 ? new Array(size).fill(padValue) : [], resizable, padValue };
		this.segments.push(newSeg);
	}

	/** Selects a segment by name and makes it the active segment for subsequent writes. */
	public useSegment(name: string) {
		const seg = this.segments.find((s) => s.name === name);
		if (!seg) throw new Error(`Segment not found: ${name}`);
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
		this.endianess = endianess === "little" ? 1 : -1;
	}

	public setOutputFile(filename: string, size?: number, maxSize?: number) {
		this.outputFile.filename = filename;
		this.outputFile.size = size;
		this.outputFile.maxSize = maxSize;
	}
	public emitString(value: string, _offset?: number) {
		this.finalObj.push(...stringToASCIICharCodes(value));
		if (this.assembler) this.PC.value += value.length;
	}
	public emitByte(value: number, offset?: number) {
		if (offset !== undefined) {
			this.finalObj[offset] = value;
			return;
		}
		pushNumber(this.finalObj, value, 1);
		if (this.assembler) this.PC.value += 1;
	}
	public emitWord(value: number, offset?: number) {
		if (offset !== undefined) {
			this.finalObj[offset] = value;
			return;
		}
		pushNumber(this.finalObj, value, this.endianess * 2);
		if (this.assembler) this.PC.value += 2;
	}
	public emitLong(value: number, offset?: number) {
		if (offset !== undefined) {
			this.finalObj[offset] = value;
			return;
		}
		pushNumber(this.finalObj, value, this.endianess * 4);
		if (this.assembler) this.PC.value += 4;
	}
	public emitBytes(value: number[], _offset?: number) {
		// if (offset !== undefined) {
		// 	this.finalObj[offset] = value;
		// 	return;
		// }
		this.finalObj.push(...value);
		if (this.assembler) this.PC.value += value.length;
	}

	public emitSegment(name: string, _offset?: number) {
		// if (offset !== undefined) {
		// 	this.finalObj[offset] = value;
		// 	return;
		// }

		const seg = this.segments.find((s) => s.name === name);
		if (!seg) throw new Error(`Segment not found: ${name}`);

		const startOffset = this.finalObj.length;
		this.finalObj.push(...seg.data);
		if (!seg.resizable) this.finalObj.push(...new Array(seg.size - seg.data.length).fill(seg.padValue ?? 0));
		if (this.assembler) this.PC.value += this.finalObj.length - startOffset;
	}

	public link(script: string, parser: Parser, assembler: Assembler) {
		const runtime: DirectiveRuntime = {
			parser: assembler.parser,
			symbolTable: assembler.symbolTable,
			evaluator: assembler.expressionEvaluator,
			lister: assembler.lister,
			logger: assembler.logger,
			linker: this,
		};
		const dispatcher = new Dispatcher(this, runtime);

		this.assembler = assembler;

		// assembler.symbolTable.clear();
		assembler.symbolTable.defineConstant("segments", this.segments);
		this.PC.value = 0;

		parser.lexer.commentChar = "#";
		parser.start(script);

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
						isAssembling: true,
						PC: this.PC,
						currentLabel,
						writebytes: (_bytes: number[]) => {},
					};
					if (!dispatcher.dispatch(directiveToken, directiveContext))
						throw new Error(`Syntax error in line ${token.line} - Unexpected directive '${directiveToken.value}'`);
					break;
				}
				case "IDENTIFIER":
					currentLabel = token.value;
					break;

				case "OPERATOR":
					if (token.value === "=" && currentLabel) {
						const directiveContext: DirectiveContext = {
							isAssembling: true,
							PC: this.PC,
							currentLabel,
							writebytes: (_bytes: number[]) => {},
						};
						if (!dispatcher.dispatch(token, directiveContext)) throw new Error(`Syntax error in line ${token.line} - Unexpected directive '${token.value}'`);
						break;
					}
					break;

				default:
					throw new Error(`Syntax error in line ${token.line} : ${token.type} ${token.value}`);
			}
		}

		return { bytes: this.finalObj, outputFile: this.outputFile };
	}
}
