import { beforeEach, describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("ProcDirective Scoping", () => {
	let assembler: Assembler;

	beforeEach(() => {
		const fileHandler = new MockFileHandler();
		assembler = new Assembler(new Cpu6502Handler(), fileHandler, {
			segments: [{ name: "CODE", start: 0x8000, size: 0, resizable: true }],
		});
	});

	it.skip("should correctly scope labels within a .PROC block", () => {
		const source = `
            .PROC MyRoutine {
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
            .PROC MyRoutine {
                PRIVATE_LABEL:
                    RTS
            }

            JMP MyRoutine::PRIVATE_LABEL ; This should fail
        `;

		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: expect.stringContaining("Undefined symbol 'MYROUTINE::PRIVATE_LABEL'"),
				location: expect.objectContaining({ line: 7 }),
			}),
		);
	});

	it("should throw an error when trying to access a procedure's internal label from outside", () => {
		const source = `
            .PROC MyRoutine {
                PRIVATE_LABEL:
                    RTS
            }

            JMP PRIVATE_LABEL ; This should fail
        `;

		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: expect.stringContaining("Undefined symbol 'PRIVATE_LABEL'"),
				location: expect.objectContaining({ line: 7 }),
			}),
		);
	});

	it("should name the procedure of a label redefined in its body", () => {
		const source = `
            .NAMESPACE ns
            .PROC MyRoutine {
                count:
                count:
                    RTS
            }
        `;

		expect(() => assembler.assemble(source)).toThrow(expect.objectContaining({ message: "Symbol 'COUNT' redefined in proc MyRoutine." }));
	});

	it("should take .PROCEDURE as .PROC", () => {
		const source = `
            .PROCEDURE MyRoutine {
                RTS
            }
            JSR MyRoutine
        `;

		expect(assembler.assemble(source)[0]?.data).toEqual([0x60, 0x20, 0x00, 0x80]);
	});
});

describe("Procedure name", () => {
	let assembler: Assembler;

	beforeEach(() => {
		assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
			segments: [{ name: "CODE", start: 0x8000, size: 0, resizable: true }],
		});
	});

	it.each([
		[
			"not the first word of the body",
			`
	nop
	.proc
		rts
	.end
`,
			3,
		],
		[
			"not the first word of the body, with .PROCEDURE",
			`
	nop
	.procedure
		rts
	.end
`,
			3,
		],
		[
			"at the end of the file",
			`
	nop
	.proc`,
			3,
		],
		[
			"not a number",
			`
	nop
	.proc 12
		rts
	.end
`,
			8,
		],
		[
			"before a { } body",
			`
	nop
	.proc {
		rts
	}
`,
			8,
		],
	])("should ask for a name, %s", (_, source, column) => {
		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({ message: "A procedure needs a name.", location: expect.objectContaining({ line: 3, column }) }),
		);
	});
});

// `.function` / `.fn` were a routine scope: without parentheses, the old form, they say to write `.proc`.
describe(".FUNCTION and .FN", () => {
	let assembler: Assembler;

	beforeEach(() => {
		assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
			segments: [{ name: "CODE", start: 0x8000, size: 0, resizable: true }],
		});
	});

	it.each([
		[
			".function",
			`
	nop
	.function clearScreen
		rts
	.end
`,
			".FUNCTION is no longer a routine scope: write .proc clearScreen. A function has parentheses: .FUNCTION clearScreen(…) = <expression>.",
		],
		[
			".fn with braces",
			`
	nop
	.fn clearScreen {
		rts
	}
`,
			".FN is no longer a routine scope: write .proc clearScreen. A function has parentheses: .FN clearScreen(…) = <expression>.",
		],
		[
			"a name on the next line",
			`
	nop
	.function
	clearScreen
	.end
`,
			".FUNCTION is no longer a routine scope: write .proc. A function has parentheses: .FUNCTION name(…) = <expression>.",
		],
	])("should be an error: %s", (_, source, message) => {
		expect(() => assembler.assemble(source)).toThrow(expect.objectContaining({ message, location: expect.objectContaining({ line: 3, column: 3 }) }));
	});

	it.each([
		[
			"a macro that isn't called",
			`
	.macro m
		.function f
		.end
	.end
	nop
`,
		],
		[
			"a false .if",
			`
	.if 0
		.function f
		.end
	.end
	nop
`,
		],
	])("should still be closed by its .END in %s", (_, source) => {
		expect(assembler.assemble(source)[0]?.data).toEqual([0xea]);
	});
});
