import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Cpu6809Handler } from "../cpu/cpu6809.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** Two relocatable segments, CODE and DATA, and a fixed one, FIXED at $1000: the source starts in CODE, `msg` is DATA+0. */
const SEGMENTS = `
	.segment CODE { reloc: true }
	.segment DATA { reloc: true }
	.segment FIXED { start: $1000, size: 0 }
	.segment DATA
msg:
	.segment FIXED
fixed:
	.segment CODE
`;

function newAssembler() {
	return new Assembler([new Cpu6502Handler(), new Cpu65C02Handler(), new Cpu6809Handler()], new MockFileHandler(), {
		logger: new Logger({ sink: new MemorySink(), enabled: false }),
	});
}

/** A segment's bytes and fixups after assembling `source`. */
function segment(source: string, name = "CODE") {
	const found = newAssembler()
		.assemble(SEGMENTS + source)
		.find((s) => s.name === name);
	return { data: found?.data, relocs: found?.relocs };
}

const assemble = (source: string) => newAssembler().assemble(SEGMENTS + source);

/** A fixup to `segment` + `targetOffset`, written at `offset` in `size` bytes, shifted by `shift`. */
const fixup = (offset: number, size: number, segment: string, targetOffset: number, shift = 0) => ({ offset, size, shift, segment, targetOffset });

describe("Fixups", () => {
	describe("in 65xx operands", () => {
		it("should write an address's offset, absolute, and record its 2 bytes", () => {
			expect(segment(`nop\nmain:\njmp main`)).toEqual({ data: [0xea, 0x4c, 0x01, 0x00], relocs: [fixup(2, 2, "CODE", 1)] });
		});

		it("should never take zero page for a relocatable address, whatever its offset", () => {
			expect(segment(`lda msg\nlda msg,x\nlda msg,y\nsta msg+2`)).toEqual({
				data: [0xad, 0x00, 0x00, 0xbd, 0x00, 0x00, 0xb9, 0x00, 0x00, 0x8d, 0x02, 0x00],
				relocs: [fixup(1, 2, "DATA", 0), fixup(4, 2, "DATA", 0), fixup(7, 2, "DATA", 0), fixup(10, 2, "DATA", 2)],
			});
		});

		it("should take the same size in both passes for an address defined later", () => {
			expect(segment(`jmp later\nnop\nlater:`)).toEqual({ data: [0x4c, 0x04, 0x00, 0xea], relocs: [fixup(1, 2, "CODE", 4)] });
		});

		it("should record one byte, its shift, for an immediate with <, > or ^", () => {
			expect(segment(`nop\nmain:\nlda #<main\nlda #>main\nldx #^main\nlda #<(main+$123)`)).toEqual({
				data: [0xea, 0xa9, 0x01, 0xa9, 0x00, 0xa2, 0x00, 0xa9, 0x24],
				relocs: [fixup(2, 1, "CODE", 1), fixup(4, 1, "CODE", 1, 8), fixup(6, 1, "CODE", 1, 16), fixup(8, 1, "CODE", 0x124)],
			});
		});

		it("should record an indirect jump's address", () => {
			expect(segment(`main:\njmp (main)`)).toEqual({ data: [0x6c, 0x00, 0x00], relocs: [fixup(1, 2, "CODE", 0)] });
			expect(segment(`.cpu 65C02\nmain:\njmp (main,x)`)).toEqual({ data: [0x7c, 0x00, 0x00], relocs: [fixup(1, 2, "CODE", 0)] });
		});

		it("should branch inside a segment with its offsets, without a fixup", () => {
			expect(segment(`loop:\ndex\nbne loop\nbeq :+\nnop\n:\n.cpu 65C02\nbbr0 $12,loop`)).toEqual({
				data: [0xca, 0xd0, 0xfd, 0xf0, 0x01, 0xea, 0x0f, 0x12, 0xf7],
				relocs: [],
			});
		});

		it("should record a fixup in a fixed segment, at its offset there", () => {
			expect(segment(`.segment FIXED\nnop\njmp msg`, "FIXED")).toEqual({ data: [0xea, 0x4c, 0x00, 0x00], relocs: [fixup(2, 2, "DATA", 0)] });
		});

		it("should record none for a fixed address or the difference of two labels", () => {
			expect(segment(`start:\njmp fixed\nlda #end - start\nend:`)).toEqual({ data: [0x4c, 0x00, 0x10, 0xa9, 0x05], relocs: [] });
		});

		it.each([
			["lda #main", "LDA #CODE+$0000: an immediate is one byte, take one of the relocatable address with <, > or ^."],
			["lda (main),y", "LDA needs a zero page address here, and CODE+$0000 is relocatable: it can't be in zero page."],
			["lda (main,x)", "LDA needs a zero page address here, and CODE+$0000 is relocatable: it can't be in zero page."],
			[".cpu 65C02\nlda (main)", "LDA needs a zero page address here, and CODE+$0000 is relocatable: it can't be in zero page."],
			[".cpu 65C02\nbbr0 main,main", "BBR0 needs a zero page address here, and CODE+$0000 is relocatable: it can't be in zero page."],
			["lda.b main", "'LDA.B' needs a zero page address here, and CODE+$0000 is relocatable: it can't be in zero page."],
			["stx main,y", "'STX' needs a zero page address here, and CODE+$0000 is relocatable: it can't be in zero page."],
			["lda <main", "LDA needs an address here, and <CODE+$0000 is one byte of a relocatable one: only an immediate (#) takes one."],
			["jmp >main", "JMP needs an address here, and >CODE+$0000 is one byte of a relocatable one: only an immediate (#) takes one."],
			["bne msg", "A branch from segment 'CODE' can't reach DATA+$0000: the distance is only known when it's loaded."],
			["bne <main", "A branch from segment 'CODE' can't reach <CODE+$0000: the distance is only known when it's loaded."],
			["bne $1000", "A branch from relocatable segment 'CODE' can't reach $1000: the distance is only known when it's loaded."],
			["bne fixed", "A branch from relocatable segment 'CODE' can't reach $1000: the distance is only known when it's loaded."],
			[".segment FIXED\nbne main", "A branch from segment 'FIXED' can't reach CODE+$0000: the distance is only known when it's loaded."],
			[".cpu 6809\nlda main", "CODE+$0000 is relocatable, and the 6809's operands can't take one: their fixups aren't recorded."],
		])("should reject %s", (statement, message) => {
			expect(() => assemble(`main:\n${statement}`)).toThrow(message);
		});
	});

	describe("in data", () => {
		it("should write an address's offset and record the element's bytes", () => {
			expect(segment(`nop\nmain:\n.dw main, 5, msg\n.dl main+2`)).toEqual({
				data: [0xea, 0x01, 0x00, 0x05, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00],
				relocs: [fixup(1, 2, "CODE", 1), fixup(5, 2, "DATA", 0), fixup(7, 4, "CODE", 3)],
			});
		});

		it("should record one byte, its shift, for <, > and ^", () => {
			expect(segment(`.db <(msg+$123456), >(msg+$123456), ^(msg+$123456)`)).toEqual({
				data: [0x56, 0x34, 0x12],
				relocs: [fixup(0, 1, "DATA", 0x123456), fixup(1, 1, "DATA", 0x123456, 8), fixup(2, 1, "DATA", 0x123456, 16)],
			});
		});

		it("should zero-extend a byte in a wider element, its fixup on the low byte", () => {
			expect(segment(`.dw <(msg+$1234), >(msg+$1234)`)).toEqual({
				data: [0x34, 0x00, 0x12, 0x00],
				relocs: [fixup(0, 1, "DATA", 0x1234), fixup(2, 1, "DATA", 0x1234, 8)],
			});
		});

		it("should put the low byte last in big-endian", () => {
			expect(segment(`.cpu 6809\n.dw <(msg+$1234), msg+$1234`)).toEqual({
				data: [0x00, 0x34, 0x12, 0x34],
				relocs: [fixup(1, 1, "DATA", 0x1234), fixup(2, 2, "DATA", 0x1234)],
			});
		});

		it("should record each element of a spread array", () => {
			expect(segment(`list = [msg, 7]\n.dw ...list`)).toEqual({ data: [0x00, 0x00, 0x07, 0x00], relocs: [fixup(0, 2, "DATA", 0)] });
		});

		it("should reject a whole address in a byte", () => {
			expect(() => assemble(`.db 1, msg`)).toThrow(
				expect.objectContaining({
					message: ".DB value: DATA+$0000 is a whole address: take one byte of it with <, > or ^.",
					location: expect.objectContaining({ line: 10, column: 8 }),
				}),
			);
		});
	});

	it("should record the fixups again on each assembly, not add to them", () => {
		const assembler = newAssembler();
		assembler.assemble(`${SEGMENTS}\njmp msg`);
		const segments = assembler.assemble(`${SEGMENTS}\njmp msg`);
		expect(segments.find((s) => s.name === "CODE")?.relocs).toEqual([fixup(1, 2, "DATA", 0)]);
	});
});
