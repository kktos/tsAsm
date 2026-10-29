import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

const LIBRARY = readFileSync(new URL("../../lib/omf.linker.asm", import.meta.url), "utf-8");

/** Serves the OMF library to the script's `.include`. */
class LibraryFileHandler extends MockFileHandler {
	override readSourceFile(filename: string): string {
		if (filename !== "omf.linker.asm") return super.readSourceFile(filename);
		this.fullpath = filename;
		this.filename = filename;
		return LIBRARY;
	}
}

const SCRIPT = `.include "omf.linker.asm"\nOMF_FILE "main"`;

/** The file the script writes, after assembling `source`. */
function link(source: string, script = SCRIPT) {
	const logger = () => new Logger({ sink: new MemorySink(), enabled: false });
	const assembler = new Assembler(new Cpu6502Handler(), new LibraryFileHandler(), { logger: logger() });
	assembler.assemble(source);
	return assembler.linker.link(script, undefined, logger()).data;
}

type Fixup = { offset: number; size: number; shift: number; value: number; segnum?: number };

/** An OMF load file's segments, read as GS/OS does (GS/OS Reference, appendix F), each checked to end where its BYTECNT says. */
function decode(file: number[]) {
	const segments = [];
	let start = 0;
	while (start < file.length) {
		const at = (offset: number, size: number) => file.slice(start + offset, start + offset + size).reduce((n, byte, i) => n + byte * 256 ** i, 0);
		const signed = (byte: number) => (byte > 127 ? byte - 256 : byte);
		const text = (offset: number, size: number) => String.fromCharCode(...file.slice(start + offset, start + offset + size));

		const dispname = at(0x28, 2);
		const segment = {
			bytecnt: at(0x00, 4),
			resspc: at(0x04, 4),
			length: at(0x08, 4),
			lablen: at(0x0d, 1),
			numlen: at(0x0e, 1),
			version: at(0x0f, 1),
			banksize: at(0x10, 4),
			kind: at(0x14, 2),
			org: at(0x18, 4),
			align: at(0x1c, 4),
			numsex: at(0x20, 1),
			segnum: at(0x22, 2),
			entry: at(0x24, 4),
			loadname: text(dispname, 10),
			segname: text(dispname + 11, at(dispname + 10, 1)),
			data: [] as number[],
			relocs: [] as Fixup[],
			intersegs: [] as Fixup[],
		};

		let record = at(0x2a, 2);
		while (true) {
			const opcode = at(record, 1);
			if (opcode === 0x00) break;
			if (opcode === 0xf2) {
				const count = at(record + 1, 4);
				segment.data = file.slice(start + record + 5, start + record + 5 + count);
				record += 5 + count;
			} else if (opcode === 0xe2) {
				segment.relocs.push({ size: at(record + 1, 1), shift: signed(at(record + 2, 1)), offset: at(record + 3, 4), value: at(record + 7, 4) });
				record += 11;
			} else if (opcode === 0xe3) {
				expect(at(record + 7, 2)).toBe(1); // the file number: this one
				segment.intersegs.push({
					size: at(record + 1, 1),
					shift: signed(at(record + 2, 1)),
					offset: at(record + 3, 4),
					segnum: at(record + 9, 2),
					value: at(record + 11, 4),
				});
				record += 15;
			} else throw new Error(`Unexpected record $${opcode.toString(16)} at ${start + record}.`);
		}
		expect(record + 1).toBe(segment.bytecnt);

		segments.push(segment);
		start += segment.bytecnt;
	}
	return segments;
}

/** The header fields every segment of the library has. */
const HEADER = { resspc: 0, lablen: 0, numlen: 4, version: 2, org: 0, numsex: 0 };

describe("The OMF library, omf.linker.asm", () => {
	it("should write each segment: its header, its bytes, a RELOC or an INTERSEG for each fixup, and END", () => {
		const source = `
			.segment CODE { reloc: true }
			.segment DATA { reloc: true, kind: $0001, loadname: "MAIN" }
			.segment CODE
				nop
			main:
				lda msg
				lda #>msg
				ldx #^msg
				jmp main
			.segment DATA
			msg:
				.db "HI"
				.dw main
		`;
		expect(decode(link(source))).toEqual([
			{
				...HEADER,
				bytecnt: 0x3b + 5 + 11 + 11 + 15 * 3 + 1, // header, LCONST, RELOC, 3 INTERSEGs, END
				length: 11,
				banksize: 0x10000,
				kind: 0x0000,
				align: 0,
				segnum: 1,
				entry: 1,
				loadname: "          ",
				segname: "CODE",
				data: [0xea, 0xad, 0x00, 0x00, 0xa9, 0x00, 0xa2, 0x00, 0x4c, 0x01, 0x00],
				relocs: [{ offset: 9, size: 2, shift: 0, value: 1 }],
				intersegs: [
					{ offset: 2, size: 2, shift: 0, segnum: 2, value: 0 },
					{ offset: 5, size: 1, shift: -8, segnum: 2, value: 0 },
					{ offset: 7, size: 1, shift: -16, segnum: 2, value: 0 },
				],
			},
			{
				...HEADER,
				bytecnt: 0x3b + 5 + 4 + 15 + 1, // header, LCONST, INTERSEG, END
				length: 4,
				banksize: 0x10000,
				kind: 0x0001,
				align: 0,
				segnum: 2,
				entry: 0,
				loadname: "MAIN      ",
				segname: "DATA",
				data: [0x48, 0x49, 0x01, 0x00],
				relocs: [],
				intersegs: [{ offset: 2, size: 2, shift: 0, segnum: 1, value: 1 }],
			},
		]);
	});

	it("should write a segment byte for byte as the specification says", () => {
		// BYTECNT $50, RESSPC, LENGTH 4, -, LABLEN, NUMLEN, VERSION, BANKSIZE $10000, KIND, -, ORG, ALIGN
		const header = [0x50, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 4, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
		// NUMSEX, -, SEGNUM 1, ENTRY 0, DISPNAME $2C, DISPDATA $3B
		const fields = [0, 0, 1, 0, 0, 0, 0, 0, 0x2c, 0, 0x3b, 0];
		// LOADNAME, 10 spaces, and SEGNAME "CODE"
		const names = [0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 4, 0x43, 0x4f, 0x44, 0x45];
		const lconst = [0xf2, 4, 0, 0, 0, 0xea, 0x4c, 0, 0];
		// `jmp main`: 2 bytes at 2, main's offset 0
		const reloc = [0xe2, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0];
		expect(link(`.segment CODE { reloc: true }\n.segment CODE\nmain:\nnop\njmp main`)).toEqual([...header, ...fields, ...names, ...lconst, ...reloc, 0x00]);
	});

	it("should take a segment's header fields from its attributes", () => {
		const source = `.segment CODE { reloc: true, kind: $8000, segname: "MAIN_CODE", banksize: 0, align: $100 }\n.segment CODE\nmain: rts`;
		expect(decode(link(source))[0]).toMatchObject({ kind: 0x8000, segname: "MAIN_CODE", banksize: 0, align: 0x100 });
	});

	it("should write a segment with a size padded to it", () => {
		expect(decode(link(`.segment CODE { reloc: true, size: 4, pad: $EA }\n.segment CODE\nmain: rts`))[0]).toMatchObject({
			length: 4,
			data: [0x60, 0xea, 0xea, 0xea],
		});
	});

	it.each([
		[
			"a fixed segment",
			`.segment CODE { reloc: true }\n.segment VECTORS { start: $FFFA, size: 6 }\n.segment CODE\nmain: rts`,
			"Segment 'VECTORS' has a start address: an OMF load file takes relocatable segments.",
		],
		[
			"an entry point out of the first segment",
			`.segment CODE { reloc: true }\n.segment INIT { reloc: true }\n.segment INIT\nmain: rts`,
			"The entry point 'main' is in segment 'INIT': it must be in the first one, 'CODE', where GS/OS starts the program.",
		],
		["an entry point not defined", `.segment CODE { reloc: true }\n.segment CODE\nrts`, "Symbol 'main' isn't defined in the source."],
		[
			"a loadname over 10 characters",
			`.segment CODE { reloc: true, loadname: "ELEVEN_CHAR" }\n.segment CODE\nmain: rts`,
			"Segment 'CODE': its loadname 'ELEVEN_CHAR' is longer than 10 characters.",
		],
		[
			"a segment larger than its bank",
			`.segment CODE { reloc: true, banksize: 2 }\n.segment CODE\nmain: nop\nnop\nrts`,
			"Segment 'CODE' is $03 bytes: it can't fit in its bank, $02 bytes.",
		],
	])("should reject %s", (_, source, message) => {
		expect(() => link(source)).toThrow(message);
	});
});
