import { beforeEach, describe, expect, it } from "vitest";
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

describe("FunctionDirective Scoping", () => {
	let assembler: Assembler;

	beforeEach(() => {
		const fileHandler = new MockFileHandler();
		assembler = new Assembler(new Cpu6502Handler(), fileHandler, {
			segments: [{ name: "CODE", start: 0x8000, size: 0, resizable: true }],
		});
	});

	it.skip("should correctly scope labels within a .FUNCTION block", () => {
		const source = `
            .FUNCTION MyRoutine {
                INNER_LOOP:
                    NOP
                    JMP INNER_LOOP  ; Jumps to 0x8000
            }

            JSR MyRoutine       ; Jumps to 0x8000

            INNER_LOOP:
                NOP             ; This is at 0x8007
                JMP INNER_LOOP  ; Jumps to 0x8007
        `;

		const segments = assembler.assemble(source);
		const code = segments[0]?.data;

		expect(code).toEqual([
			// MyRoutine at 0x8000
			0xea, // NOP
			0x4c,
			0x00,
			0x80, // JMP $8000 (MyRoutine.INNER_LOOP)

			// JSR MyRoutine at 0x8004
			0x20,
			0x00,
			0x80, // JSR $8000

			// Global INNER_LOOP at 0x8007
			0xea, // NOP
			0x4c,
			0x07,
			0x80, // JMP $8007 (global INNER_LOOP)
		]);
	});

	it.skip("should error even with prefix", () => {
		const source = `
            .FUNCTION MyRoutine {
                PRIVATE_LABEL:
                    RTS
            }

            JMP MyRoutine::PRIVATE_LABEL ; This should fail
        `;

		expect(() => assembler.assemble(source)).toThrow(
			/line 7: Invalid instruction syntax or unresolved symbol. Error: Undefined symbol 'MYROUTINE::PRIVATE_LABEL'./,
		);
	});

	it("should throw an error when trying to access a function's internal label from outside", () => {
		const source = `
            .FUNCTION MyRoutine {
                PRIVATE_LABEL:
                    RTS
            }

            JMP PRIVATE_LABEL ; This should fail
        `;

		expect(() => assembler.assemble(source)).toThrow(/line 7: Invalid instruction syntax or unresolved symbol. Error: Undefined symbol 'PRIVATE_LABEL'./);
	});
});
