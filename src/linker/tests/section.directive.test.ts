import { beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../helpers/logger.class";
import { MemorySink } from "../../helpers/memorysink.class";
import { Linker } from "../linker.class";

describe("Linker Script: .SECTION and .WRITE … AT", () => {
	let linker: Linker;
	let sink: MemorySink;
	const link = (script: string) => linker.link(script, undefined, new Logger({ sink })).data;

	beforeEach(() => {
		linker = new Linker(0);
		sink = new MemorySink();
	});

	describe(".SECTION … AT", () => {
		it("should write over a FIXED output at the offset", () => {
			expect(link('.OUTPUT "x" FIXED 6 PAD $FF\n.WRITE BYTES [1, 2]\n.SECTION S AT 3\n.WRITE BYTES [7, 8]')).toEqual([1, 2, 0xff, 7, 8, 0xff]);
		});

		it("should pad an output that isn't FIXED up to a section past its end", () => {
			expect(link('.OUTPUT "x"\n.WRITE BYTES [1, 2]\n.SECTION S AT 4\n.WRITE BYTE 9')).toEqual([1, 2, 0, 0, 9]);
		});

		it("should write over an output that isn't FIXED, and extend it", () => {
			expect(link('.OUTPUT "x"\n.WRITE BYTES [1, 2, 3]\n.SECTION S AT 2\n.WRITE BYTES [7, 8]')).toEqual([1, 2, 7, 8]);
		});

		it("should give .PC as the offset in the output where the next byte goes", () => {
			link('.OUTPUT "x"\n.WRITE BYTES [1, 2, 3]\n.SECTION S AT $10\n.LOG .PC\n.WRITE WORD 0\n.LOG .PC\n.SECTION BACK\n.LOG .PC');
			expect(sink.logs.filter((line) => /^\d+$/.test(line))).toEqual(["16", "18", "3"]);
		});

		it("should take the data directives", () => {
			expect(link('.OUTPUT "x" FIXED 4\n.SECTION S AT 1\n.BYTE 5\n.FILL 2, 6')).toEqual([0, 5, 6, 6]);
		});

		it("should apply the sections in order: the last one wins", () => {
			expect(link('.OUTPUT "x" FIXED 4\n.SECTION A AT 0\n.WRITE BYTES [1, 1, 1]\n.SECTION B AT 1\n.WRITE BYTE 2')).toEqual([1, 2, 1, 0]);
		});

		it("should report a FIXED output made too large by a section", () => {
			expect(() => link('.OUTPUT "x" FIXED 2\n.SECTION S AT 1\n.WRITE WORD 0')).toThrow(
				"Output file is too large. Max size is 2 bytes, but the linker output is 3 bytes",
			);
		});

		it("should report a FIXED output written past its size, not crash", () => {
			expect(() => link('.OUTPUT "x" FIXED 2\n.WRITE BYTES [1, 2, 3]')).toThrow(
				"Output file is too large. Max size is 2 bytes, but the linker output is 3 bytes",
			);
		});

		it("should pad a FIXED output to its size even when only sections write to it", () => {
			expect(link('.OUTPUT "x" FIXED 3 PAD $FF\n.SECTION S AT 1\n.WRITE BYTE 1')).toEqual([0xff, 1, 0xff]);
		});

		it("should report a negative offset", () => {
			expect(() => link('.OUTPUT "x"\n.SECTION S AT -1')).toThrow("Invalid offset -1: it can't be negative.");
		});
	});

	describe(".WRITE … AT", () => {
		it.each([
			["BYTE $12", [0, 0x12, 0, 0, 0]],
			["WORD $1234", [0, 0x34, 0x12, 0, 0]],
			["LONG $12345678", [0, 0x78, 0x56, 0x34, 0x12]],
			['STRING "AB"', [0, 0x41, 0x42, 0, 0]],
			["BYTES [7, 8, 9]", [0, 7, 8, 9, 0]],
		])("should write %s at the offset", (value, bytes) => {
			expect(link(`.OUTPUT "x" FIXED 5\n.WRITE ${value} AT 1`)).toEqual(bytes);
		});

		it("should follow .ENDIAN", () => {
			expect(link('.OUTPUT "x" FIXED 4\n.ENDIAN BIG\n.WRITE WORD $1234 AT 1')).toEqual([0, 0x12, 0x34, 0]);
		});

		it("should write over what is written after it, and not move .PC", () => {
			expect(link('.OUTPUT "x"\n.WRITE WORD $1234 AT 1\n.LOG .PC\n.WRITE BYTES [1, 2, 3, 4]')).toEqual([1, 0x34, 0x12, 4]);
			expect(sink.logs).toContain("0");
		});

		it("should pad an output that isn't FIXED up to the offset", () => {
			expect(link('.OUTPUT "x"\n.WRITE BYTE 1\n.WRITE WORD $1234 AT 3')).toEqual([1, 0, 0, 0x34, 0x12]);
		});

		it("should pad with the FIXED pad value", () => {
			expect(link('.OUTPUT "x" FIXED 3 PAD $FF\n.WRITE BYTE 1 AT 1')).toEqual([0xff, 1, 0xff]);
		});

		it("should be an offset of the output in a section too", () => {
			expect(link('.OUTPUT "x" FIXED 6\n.SECTION S AT 2\n.WRITE BYTE 1\n.WRITE BYTE 9 AT 5\n.WRITE BYTE 2')).toEqual([0, 0, 1, 2, 0, 9]);
		});

		it("should report a negative offset", () => {
			expect(() => link('.OUTPUT "x"\n.WRITE BYTE 1 AT -2')).toThrow("Invalid offset -2: it can't be negative.");
		});
	});

	describe("segments and modules", () => {
		beforeEach(() => {
			linker.addModule("M");
			linker.addSegment("CODE", 0x1000, 2);
			linker.useSegment("CODE");
			linker.writeBytes(0x1000, [1, 2]);
			// fixed, 1 byte of 3 written: padded with its pad value
			linker.addSegment("DATA", 0x2000, 3, 0xee);
			linker.useSegment("DATA");
			linker.writeBytes(0x2000, [9]);
		});

		it("should write a segment in a section, and move .PC", () => {
			expect(link('.OUTPUT "x" FIXED 6\n.SECTION S AT 3\n.WRITE SEGMENT "CODE"\n.LOG .PC')).toEqual([0, 0, 0, 1, 2, 0]);
			expect(sink.logs).toContain("5");
		});

		it("should write a module in a section", () => {
			expect(link('.OUTPUT "x" FIXED 7\n.SECTION S AT 1\n.WRITE MODULE "M"\n.WRITE BYTE 5')).toEqual([0, 1, 2, 9, 0xee, 0xee, 5]);
		});

		it("should write a segment at an offset, padded to its size, without moving .PC", () => {
			expect(link('.OUTPUT "x"\n.WRITE BYTE 7\n.WRITE SEGMENT "DATA" AT 2\n.LOG .PC')).toEqual([7, 0, 9, 0xee, 0xee]);
			expect(sink.logs).toContain("1");
		});

		it("should write a module at an offset", () => {
			expect(link('.OUTPUT "x" FIXED 6 PAD $FF\n.WRITE MODULE("M") AT 1')).toEqual([0xff, 1, 2, 9, 0xee, 0xee]);
		});

		it("should count what a section or AT writes as written", () => {
			link('.OUTPUT "x"\n.SECTION S AT 0\n.WRITE SEGMENT "CODE"\n.WRITE MODULE "M" AT 8\n.LOG .len(.UNWRITTEN_SEGMENTS), " ", .len(.UNWRITTEN_MODULES)');
			expect(sink.logs).toContain("0\t \t0");
		});

		it("should still append in the output, outside sections", () => {
			expect(link('.OUTPUT "x"\n.WRITE SEGMENT "CODE"\n.SECTION S AT 0\n.WRITE BYTE 7\n.SECTION BACK\n.WRITE SEGMENT "DATA"')).toEqual([7, 2, 9, 0xee, 0xee]);
		});
	});
});
