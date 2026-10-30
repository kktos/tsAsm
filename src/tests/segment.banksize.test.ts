import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import type { AsmError } from "../utils/error.utils";
import { MockFileHandler } from "./mockfilehandler.class";

const newAssembler = (segments?: SegmentDefinition[], sink = new MemorySink()) =>
	new Assembler(new Cpu6502Handler(), new MockFileHandler(), { logger: new Logger({ sink, enabled: true }), segments, log: { pass1Enabled: true } });

const errorOf = (source: string, segments?: SegmentDefinition[]) => {
	try {
		newAssembler(segments).assemble(source);
	} catch (e) {
		return e as AsmError;
	}
	throw new Error("expected the assembly to fail");
};

/** The output of the linker `script`, after assembling `source`. */
function link(source: string, script: string) {
	const assembler = newAssembler();
	assembler.assemble(source);
	return assembler.linker.link(script, undefined, new Logger({ sink: new MemorySink(), enabled: false })).data;
}

describe("A segment's banksize", () => {
	describe("in .segment", () => {
		it("should take a fixed segment in one bank, the key in any case, and not as an attribute", () => {
			const source = `
				.segment BANK1 { start: $A000, size: $2000, BankSize: $2000 }
			`;
			const [segment] = newAssembler().assemble(source);
			expect(segment).toMatchObject({ banksize: 0x2000, attrs: {} });
		});

		it("should refuse a fixed segment crossing a bank, at its definition", () => {
			const source = `
				.segment BANK1 { start: $9000, size: $2000, banksize: $2000 }
			`;
			const error = errorOf(source);
			expect(error.message).toContain("Segment 'BANK1' ($9000..$AFFF) crosses a bank: its banksize is $2000.");
			expect(error.location.line).toBe(2);
		});

		it("should refuse a relocatable segment bigger than its bank", () => {
			const source = `
				.segment CODE { reloc: true, size: $101, banksize: $100 }
			`;
			expect(errorOf(source).message).toContain("Segment 'CODE' is $101 bytes, more than its banksize, $100.");
		});

		it("should take a segment growing up to its bank's end, and refuse the write taking it past", () => {
			const source = `
				.segment BANK1 { start: $8000, size: 0, banksize: $2000 }
				.segment BANK1
				.fill $1FFE
				.db 1
				.dw 2
			`;
			const error = errorOf(source);
			expect(error.message).toContain("Segment 'BANK1' ($8000..$A000) crosses a bank: its banksize is $2000.");
			expect(error.location.line).toBe(6);
		});

		it("should refuse a relocatable segment growing past its bank, at that instruction", () => {
			const source = `
				.segment CODE { reloc: true, banksize: $100 }
				.segment CODE
				.fill $FF
				nop
				lda $1234
			`;
			const error = errorOf(source);
			expect(error.message).toContain("Segment 'CODE' is $103 bytes, more than its banksize, $100.");
			expect(error.location.line).toBe(6);
		});

		it("should take a banksize of 0, no bank", () => {
			const source = `
				.segment DATA { start: $9000, size: $2000, banksize: 0 }
			`;
			expect(newAssembler().assemble(source)[0]?.banksize).toBe(0);
		});

		it.each([["$3000"], ["-2"]])("should refuse a banksize of %s, neither 0 nor a power of two", (banksize) => {
			const source = `
				.segment DATA { start: $9000, size: $10, banksize: ${banksize} }
			`;
			expect(errorOf(source).message).toContain(`Segment 'DATA': its banksize, ${banksize}, isn't 0 (no bank) or a power of two.`);
		});

		it("should list it after the segment's bounds", () => {
			const sink = new MemorySink();
			newAssembler(undefined, sink).assemble(`
				.segment CODE { reloc: true, banksize: $10000, kind: $1000 }
			`);
			expect(sink.logs.some((line) => String(line).includes("{ relocatable, size: $00, pad: $00, banksize: $010000, kind: $1000 }"))).toBe(true);
		});
	});

	describe("in the project file's segments", () => {
		it("should take it, not as an attribute", () => {
			const [segment] = newAssembler([{ name: "CODE", reloc: true, banksize: 0x10000 }]).assemble("");
			expect(segment).toMatchObject({ banksize: 0x10000, attrs: {} });
		});

		it.each([
			[{ name: "BANK1", start: 0x9000, size: 0x2000, banksize: 0x2000 }, "Segment 'BANK1' ($9000..$AFFF) crosses a bank: its banksize is $2000."],
			[{ name: "BANK1", start: 0x8000, size: 0x2000, bankSize: 0x2000 }, "Segment 'BANK1': 'bankSize' is written 'banksize'."],
		])("should refuse %j", (segment, message) => {
			expect(() => newAssembler([segment])).toThrow(message);
		});
	});

	describe("read by the linker script", () => {
		it("should be seg.banksize, there only when given", () => {
			const source = `
				.segment CODE { reloc: true, banksize: 0 }
				.segment DATA { reloc: true }
			`;
			const script = `
				code = .segment("CODE")
				.WRITE BYTE .has(code, "banksize")
				.WRITE BYTE code.banksize
				.WRITE BYTE .has(.segment("DATA"), "banksize")
			`;
			expect(link(source, script)).toEqual([1, 0, 0]);
		});
	});
});
