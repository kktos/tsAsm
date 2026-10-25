import { describe, expect, it } from "vitest";
import { Assembler } from "../../assembler/polyasm";
import { Cpu6502Handler } from "../../cpu/cpu6502.class";
import { MockFileHandler } from "../mockfilehandler.class";

describe("Function .SEGMENT()", () => {
	const assemble = (source: string) => {
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler());
		const segments = assembler.assemble(source);
		return segments.find((s) => s.name === "CODE")?.data.slice(0, 4);
	};

	it("should return a segment defined before", () => {
		const source = `
			.SEGMENT DATA { start: $9000, size: $10 }
			.SEGMENT CODE { start: $8000, size: $10 }
			.SEGMENT "CODE"
			s = .segment("DATA")
			.WORD s.start, s.size
		`;
		expect(assemble(source)).toEqual([0x00, 0x90, 0x10, 0x00]);
	});

	it("should return a segment defined further down", () => {
		const source = `
			.SEGMENT CODE { start: $8000, size: $10 }
			.SEGMENT "CODE"
			s = .segment("DATA")
			.WORD s.start, s.size
			.SEGMENT DATA { start: $9000, size: $10 }
		`;
		expect(assemble(source)).toEqual([0x00, 0x90, 0x10, 0x00]);
	});

	it("should size an instruction using a segment defined further down", () => {
		const source = `
			.SEGMENT CODE { start: $8000, size: $10 }
			.SEGMENT "CODE"
			s = .segment("DATA")
			lda s.start
			rts
			.SEGMENT DATA { start: $9000, size: $10 }
		`;
		expect(assemble(source)).toEqual([0xad, 0x00, 0x90, 0x60]);
	});

	it("should throw for a segment never defined", () => {
		const source = `
			.SEGMENT CODE { start: $8000, size: $10 }
			.SEGMENT "CODE"
			s = .segment("NOPE")
		`;
		expect(() => assemble(source)).toThrow("Segment 'NOPE' not found.");
	});

	it("should throw for a name that isn't a string", () => {
		const source = `
			.SEGMENT CODE { start: $8000, size: $10 }
			.SEGMENT "CODE"
			s = .segment(1)
		`;
		expect(() => assemble(source)).toThrow("Argument to .SEGMENT() must be a string.");
	});
});
