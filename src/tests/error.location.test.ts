import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { FileHandler } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
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
		const assembler = new Assembler(new Cpu6502Handler(), fileHandler, { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
		try {
			assembler.assemble(source);
		} catch (e) {
			return e;
		}
		throw new Error("expected the assembly to fail");
	};

	it.each([
		// the statement's first token, in the main file
		["start:\n  nop\n  lda missing", { file: "main.asm", line: 3, column: 3 }],
		["  .fill -1", { file: "main.asm", line: 1, column: 3 }],
		// a statement of an included file
		['  nop\n  .include "lib.asm"', { file: "lib.asm", line: 2, column: 3 }],
		// the lexer knows the character
		["  nop\n  lda @x", { file: "main.asm", line: 2, column: 7 }],
		// a parser error knows its token
		["  nop\n  .foo 1", { file: "main.asm", line: 2, column: 4 }],
	])("should report %j at its location", (source, location) => {
		const error = assemble(source);
		expect(error).toBeInstanceOf(AsmError);
		expect((error as AsmError).location).toEqual(location);
	});

	it("should turn whatever was thrown into an AsmError", () => {
		// the operand error is thrown as a string by the instruction handling
		const error = assemble("  nop\n  lda #1 +");
		expect(error).toBeInstanceOf(AsmError);
		expect((error as AsmError).location).toEqual({ file: "main.asm", line: 2, column: 3 });
	});

	it("should format as file:line:column: error: message, then the source line with a caret", () => {
		expect((assemble("  nop\n  lda @x") as AsmError).format()).toBe(
			["main.asm:2:7: error: Unexpected character '@' (U+0040) on line 2, column 7.", "    2 |   lda @x", "      |       ^"].join("\n"),
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

	it("should not show a source line for a macro body line yet", () => {
		const error = assemble(".macro m\n  lda missing\n.end\n  m") as AsmError;
		expect(error.location.line).toBe("4.2");
		expect(error.sourceLine).toBeUndefined();
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
});
