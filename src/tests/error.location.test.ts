import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { FileHandler } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { AsmError } from "../utils/error.utils";

describe("Error locations", () => {
	const files: Record<string, string> = { "lib.asm": "nop\n  lda missing\n" };
	const assemble = (source: string) => {
		const fileHandler: FileHandler = {
			fullpath: "main.asm",
			filename: "main.asm",
			readSourceFile(filename: string) {
				this.fullpath = filename;
				this.filename = filename;
				return files[filename] ?? "";
			},
			readBinaryFile: () => [],
		};
		const assembler = new Assembler(new Cpu6502Handler(), fileHandler, {
			segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		});
		try {
			assembler.assemble(source);
		} catch (e) {
			return e;
		}
		throw new Error("expected the assembly to fail");
	};

	it.each([
		// the token at fault, in the main file
		["start:\n  nop\n  lda missing", { file: "main.asm", line: 3, column: 7 }],
		// the statement's first token when there's no better one
		["  .fill -1", { file: "main.asm", line: 1, column: 3 }],
		// in an included file
		['  nop\n  .include "lib.asm"', { file: "lib.asm", line: 2, column: 7 }],
		// the lexer knows the character
		["  nop\n  lda @x", { file: "main.asm", line: 2, column: 7 }],
		// a parser error knows its token
		["  nop\n  .foo 1", { file: "main.asm", line: 2, column: 4 }],
	])("should report %j at its location", (source, location) => {
		const error = assemble(source);
		expect(error).toBeInstanceOf(AsmError);
		expect((error as AsmError).location).toEqual(location);
	});

	it.each([
		// pass 2
		["  nop\n  lda missing", "Undefined symbol 'MISSING'."],
		// pass 1
		["  nop\n  lda #1 +", "Binary operator '+' requires two operands."],
	])("should give an instruction's error as it is, without wrapping it: %j", (source, message) => {
		expect((assemble(source) as AsmError).message).toBe(message);
	});

	it("should turn whatever was thrown into an AsmError", () => {
		// the operand error is thrown as a string by the instruction handling
		const error = assemble("  nop\n  lda #1 +");
		expect(error).toBeInstanceOf(AsmError);
		expect((error as AsmError).location).toEqual({ file: "main.asm", line: 2, column: 10 });
	});

	it("should format as file:line:column: error: message, then the source line with a caret", () => {
		expect((assemble("  nop\n  lda @x") as AsmError).format()).toBe(
			["main.asm:2:7: error: Unexpected character '@' (U+0040).", "    2 |   lda @x", "      |       ^"].join("\n"),
		);
	});

	it.each([
		// tabs are kept, so the caret lines up under the column
		["\tnop\n\tlda\t@x", "\tlda\t@x", "\t   \t^"],
		// the line ending isn't part of the line
		["  nop\r\n  lda @x\r\n", "  lda @x", "      ^"],
		// nor is a byte order mark
		["\uFEFF lda @x", " lda @x", "     ^"],
	])("should show the source line of %j", (source, line, caret) => {
		const [, text, caretLine] = (assemble(source) as AsmError).format().split("\n");
		expect(text?.slice(8)).toBe(line);
		expect(caretLine?.slice(8)).toBe(caret);
	});

	it("should show the source line of an included file", () => {
		const error = assemble('  nop\n  .include "lib.asm"') as AsmError;
		expect(error.sourceLine).toBe("  lda missing");
	});

	describe("in a macro body", () => {
		it("should report the body line, and the call", () => {
			const error = assemble(".macro m\n  lda missing\n.end\n  nop\n  m") as AsmError;
			expect(error.location).toEqual({ file: "main.asm", line: 2, column: 7 });
			expect(error.sourceLine).toBe("  lda missing");
			expect(error.macroStack).toEqual([{ name: "m", calledAt: { file: "main.asm", line: 5, column: 3 } }]);
		});

		it("should report a macro defined in an included file, and nested calls, innermost first", () => {
			files["macros.asm"] = ".macro load v\n  lda missing\n.end\n.macro twice v\n  load v\n.end\n";
			const error = assemble('.include "macros.asm"\n  nop\n  twice 1') as AsmError;
			expect(error.location).toEqual({ file: "macros.asm", line: 2, column: 7 });
			expect(error.macroStack).toEqual([
				{ name: "load", calledAt: { file: "macros.asm", line: 5, column: 3 } },
				{ name: "twice", calledAt: { file: "main.asm", line: 3, column: 3 } },
			]);
		});

		it("should report a line of a loop in a macro body", () => {
			const error = assemble(".macro m\n.repeat 2\n  lda missing\n.end\n.end\n  m") as AsmError;
			expect(error.location).toEqual({ file: "main.asm", line: 3, column: 7 });
			expect(error.macroStack).toEqual([{ name: "m", calledAt: { file: "main.asm", line: 6, column: 3 } }]);
		});

		it("should show the calls under the source line", () => {
			const text = (assemble(".macro m\n  lda missing\n.end\n  nop\n  m") as AsmError).format().split("\n");
			expect(text.slice(1)).toEqual(["    2 |   lda missing", "      |       ^", "  in macro m, called at main.asm:5:3"]);
		});
	});

	it("should format a source line given with the error", () => {
		const error = new AsmError("boom", { file: "a.asm", line: 12, column: 3 });
		error.sourceLine = "  lda #1";
		expect(error.format()).toBe(["a.asm:12:3: error: boom", "   12 |   lda #1", "      |   ^"].join("\n"));
	});

	it.each([
		[{ file: "a.asm", line: 2, column: 7 }, "a.asm:2:7: error: boom"],
		[{ line: 2, column: 7 }, "2:7: error: boom"],
		[{ file: "", line: 2, column: 7 }, "2:7: error: boom"],
		[{}, "error: boom"],
	])("should format the parts of the location it has: %j", (location, text) => {
		expect(new AsmError("boom", location).format()).toBe(text);
		expect(String(new AsmError("boom", location))).toBe(text);
	});

	/** A redefinition's message, where it is, and where its note says the name is first defined. */
	const redefinition = (source: string) => {
		const error = assemble(source) as AsmError;
		return { message: error.message, at: error.location, note: error.notes[0]?.location };
	};

	it("should say where a redefined label is first defined", () => {
		const source = `
			lbl: nop
			nop
			lbl: nop
		`;
		expect(redefinition(source)).toMatchObject({
			message: "Symbol 'LBL' redefined.",
			at: { file: "main.asm", line: 4, column: 4 },
			note: { file: "main.asm", line: 2, column: 4 },
		});
	});

	// A macro is located at its statement's start, as the errors are: the `.`, not the directive's name. A symbol is located at its name.
	it("should say where a redefined macro is first defined", () => {
		const source = `
			.macro m
			.end
			nop
			.macro m
			.end
		`;
		expect(redefinition(source)).toMatchObject({
			message: "Macro 'm' redefined: a macro can only be defined once.",
			at: { file: "main.asm", line: 5, column: 4 },
			note: { file: "main.asm", line: 2, column: 4 },
		});
	});

	it("should say where a redefined .equ is first defined", () => {
		const source = `
			X .equ 1
			X .equ 2
		`;
		expect(redefinition(source)).toMatchObject({
			message: "Symbol 'X' redefined.",
			at: { file: "main.asm", line: 3, column: 6 },
			note: { file: "main.asm", line: 2, column: 4 },
		});
	});

	it("should say where a .let variable redefined as a constant is first defined", () => {
		const source = `
			.let X = 1
			X .equ 2
		`;
		expect(redefinition(source)).toMatchObject({
			message: "Symbol 'X' redefined.",
			at: { file: "main.asm", line: 3, column: 6 },
			note: { file: "main.asm", line: 2, column: 9 },
		});
	});

	it("should say where a constant given to .let is defined", () => {
		const source = `
			X .equ 1
			.let X = 2
		`;
		expect(redefinition(source)).toMatchObject({
			message: "Can't redefine constant 'X'.",
			at: { file: "main.asm", line: 3, column: 4 },
			note: { file: "main.asm", line: 2, column: 4 },
		});
	});

	it("should say where a redefined procedure is first defined", () => {
		const source = `
			.proc f
			.end
			.proc f
			.end
		`;
		expect(redefinition(source)).toMatchObject({
			message: "Symbol 'F' redefined.",
			at: { file: "main.asm", line: 4, column: 4 },
			note: { file: "main.asm", line: 2, column: 10 },
		});
	});

	it("should say where a loop's iterator is defined", () => {
		const source = `
			.repeat 2 AS i
			i .equ 1
			.end
		`;
		expect(redefinition(source)).toMatchObject({
			message: "Symbol 'I' redefined.",
			at: { file: "main.asm", line: 3, column: 6 },
			note: { file: "main.asm", line: 2, column: 17 },
		});
	});

	it("should locate and format a warning like an error", () => {
		const sink = new MemorySink();
		const fileHandler: FileHandler = {
			fullpath: "main.asm",
			filename: "main.asm",
			readSourceFile: () => "",
			readBinaryFile: () => [],
		};
		const assembler = new Assembler(new Cpu6502Handler(), fileHandler, {
			logger: new Logger({ sink, enabled: true }),
			segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		});
		assembler.assemble('  nop\n  .warning "careful"');
		expect(sink.warnings).toEqual([["main.asm:2:3: warning: careful", '    2 |   .warning "careful"', "      |   ^"].join("\n")]);
	});
});
