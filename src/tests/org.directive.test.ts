import { describe, expect, it } from "vitest";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Assembler } from "../polyasm";
import type { FileHandler, SegmentDefinition } from "../polyasm.types";

class MockFileHandler implements FileHandler {
	fullpath = "";
	readSourceFile(filename: string): string {
		throw new Error(`Mock file not found: "${filename}"`);
	}
	readBinaryFile(filename: string): number[] {
		throw new Error(`Mock bin file not found: ${filename}`);
	}
}

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("Directive: .ORG / *", () => {
	const createAssembler = (segments: SegmentDefinition[] = DEFAULT_SEGMENTS) => {
		const mockFileHandler = new MockFileHandler();
		const cpu = new Cpu6502Handler();
		return new Assembler(cpu, mockFileHandler, { segments });
	};

	describe(".ORG", () => {
		it("should set the program counter to a new address", () => {
			const source = `
            .cpu "6502"
            .org $2000
            LDA #$10
        `;
			const asm = createAssembler();
			const segments = asm.assemble(source);

			expect(segments.length).toBe(1);
			expect(segments[0]).toBeDefined();
			if (segments[0]) {
				expect(segments[0].name).toBe("CODE");
				expect(segments[0].start).toBe(0x1000);
				const offset = 0x2000 - segments[0]?.start;
				expect(segments[0].data[offset]).toBe(0xa9); // LDA immediate
				expect(segments[0].data[offset + 1]).toBe(0x10);
			}
		});

		it("should handle multiple .org directives", () => {
			const source = `
            .cpu "6502"
            .org $2000
            NOP
            .org $2010
            NOP
        `;
			const asm = createAssembler();
			const segments = asm.assemble(source);
			expect(segments[0]).toBeDefined();
			if (segments[0]) {
				const offset1 = 0x2000 - segments[0].start;
				expect(segments[0].data[offset1]).toBe(0xea); // NOP

				const offset2 = 0x2010 - segments[0].start;
				expect(segments[0].data[offset2]).toBe(0xea); // NOP
			}
		});

		it("should fail if out of current segment boundaries", () => {
			const source = `
            .cpu "6502"
            .org $300
            NOP
        `;
			const asm = createAssembler();
			expect(() => asm.assemble(source)).toThrow(/Error: Write out of bounds: address \$300 is below segment 'CODE' start \$1000./);
		});
	});

	describe("*", () => {
		it("should fail if value is not a number", () => {
			const source = `
            * = "test"
        `;
			const asm = createAssembler();
			expect(() => asm.assemble(source)).toThrow(/- Invalid value for \*\/ORG test -/);
		});

		it("should handle multiple * assign", () => {
			const source = `
            .cpu "6502"
            * = $2000
            NOP
            * = $2010
            NOP
        `;
			const asm = createAssembler();
			const segments = asm.assemble(source);
			expect(segments[0]).toBeDefined();
			// expect(segments[0]).toBe("");
			if (segments[0]) {
				const offset1 = 0x2000 - segments[0].start;
				expect(segments[0].data[offset1]).toBe(0xea); // NOP

				const offset2 = 0x2010 - segments[0].start;
				expect(segments[0].data[offset2]).toBe(0xea); // NOP
			}
		});
	});
});
