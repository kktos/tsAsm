import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6809Handler } from "../cpu/cpu6809.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Assembler - 6809 Opcodes", () => {
	it("should assemble basic 6809 instructions", () => {
		const fileHandler = new MockFileHandler();
		const assembler = new Assembler(new Cpu6809Handler(), fileHandler);

		const source = `
            .org $1000
            LDA #$10      ; Immediate
            LDB $20       ; Direct
            STA $1234     ; Extended
            NEGA          ; Inherent
            NOP           ; Inherent
        `;

		const segments = assembler.assemble(source);
		const code = assembler.link(segments);

		const expectedBytes = [
			// LDA #$10
			0x86, 0x10,
			// LDB $20
			0x96, 0x20,
			// STA $1234
			0xb7, 0x12, 0x34,
			// NEGA
			0x40,
			// NOP
			0x12,
		];

		expect(code.slice(0, expectedBytes.length)).toEqual(expectedBytes);
	});

	it("should assemble relative branches", () => {
		const fileHandler = new MockFileHandler();
		const assembler = new Assembler(new Cpu6809Handler(), fileHandler);

		const source = `
            .org $1000
            BRA loop_back
            NOP
        loop_back:
            BRA loop_forward
            NOP
        loop_forward:
        `;

		const segments = assembler.assemble(source);
		const code = assembler.link(segments);

		const expectedBytes = [
			// BRA loop_back ($1000 -> $1003)
			0x20,
			0x01, // Offset = $1003 - ($1000 + 2) = 1
			// NOP
			0x12,
			// loop_back: ($1003)
			// BRA loop_forward ($1003 -> $1006)
			0x20,
			0x01, // Offset = $1006 - ($1003 + 2) = 1
			// NOP
			0x12,
			// loop_forward: ($1006)
		];

		expect(code.slice(0, expectedBytes.length)).toEqual(expectedBytes);
	});
});
