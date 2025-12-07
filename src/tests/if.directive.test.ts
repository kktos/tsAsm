import { describe, expect, it } from "vitest";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Assembler } from "../polyasm";
import type { FileHandler } from "../polyasm.types";

class MockFileHandler implements FileHandler {
	fullpath = "";
	readSourceFile(filename: string): string {
		throw new Error(`Mock file not found: "${filename}"`);
	}
	readBinaryFile(filename: string): number[] {
		throw new Error(`Mock bin file not found: ${filename}`);
	}
}

describe("Directive: .if/.else", () => {
	const createAssembler = () => {
		const mockFileHandler = new MockFileHandler();
		const cpu = new Cpu6502Handler();
		return new Assembler(cpu, mockFileHandler);
	};

	it("should assemble code inside a true .if block", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 1
            NOP
            .end
        `;
		const asm = createAssembler();
		asm.assemble(source);

		expect(asm.currentPC).toBe(0x2001);
		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0xea); // NOP
		}
	});

	it("should not assemble code inside a false .if block", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 0
            NOP
            .end
            LDA #$42
        `;
		const asm = createAssembler();
		asm.assemble(source);

		expect(asm.currentPC).toBe(0x2002);
		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0xa9); // LDA immediate
			expect(segments[0].data[offset + 1]).toBe(0x42);
		}
	});

	it("should assemble the .if block but not the .else block when condition is true", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 1
            NOP
            .else
            CLC
            .end
        `;
		const asm = createAssembler();
		asm.assemble(source);

		expect(asm.currentPC).toBe(0x2001);
		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0xea); // NOP
			expect(segments[0].data[offset]).not.toBe(0x18); // CLC
		}
	});

	it("should assemble the .else block but not the .if block when condition is false", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 0
            NOP
            .else
            CLC
            .end
        `;
		const asm = createAssembler();
		asm.assemble(source);

		expect(asm.currentPC).toBe(0x2001);
		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0x18); // CLC
			expect(segments[0].data[offset]).not.toBe(0xea); // NOP
		}
	});

	it("should handle nested .if directives correctly", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 1
              .if 0
                NOP       ; should not be assembled
              .else
                SEC       ; should be assembled
              .end
              CLC         ; should be assembled
            .end
        `;
		const asm = createAssembler();
		asm.assemble(source);

		expect(asm.currentPC).toBe(0x2002);
		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0x38); // SEC
			expect(segments[0].data[offset + 1]).toBe(0x18); // CLC
		}
	});

	it("should handle C-style blocks", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 1 {
                NOP  ; should be assembled
            } .else {
                SEC  ; should NOT be assembled
            }
            .if 0 {
                NOP ; should NOT be assembled
            } .else {
                CLC ; should be assembled
            }
        `;
		const asm = createAssembler();
		asm.assemble(source);

		expect(asm.currentPC).toBe(0x2002);
		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0xea); // NOP
			expect(segments[0].data[offset + 1]).toBe(0x18); // CLC
		}
	});

	it("should handle mixed C-style and asm-style blocks", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 1 {
				.if 0
					NOP ; should NOT be assembled
				.else
					CLC ; should be assembled
				.end
            } .else {
                SEC  ; should NOT be assembled
            }
        `;
		const asm = createAssembler();
		asm.assemble(source);

		expect(asm.currentPC).toBe(0x2001);
		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0x18); // CLC
		}
	});
});
