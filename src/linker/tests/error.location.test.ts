import { describe, expect, it } from "vitest";
import type { FileHandler } from "../../assembler/polyasm.types";
import { Logger } from "../../helpers/logger.class";
import { MemorySink } from "../../helpers/memorysink.class";
import { AsmError } from "../../utils/error.utils";
import { Linker } from "../linker.class";

describe("Linker Script: error locations", () => {
	const files: Record<string, string> = { "lib.ld": '.WRITE BYTE 1\n  .WRITE BYTE "x"\n' };
	const fileHandler = (): FileHandler => ({
		fullpath: "link.ld",
		filename: "link.ld",
		readSourceFile(filename: string) {
			this.fullpath = filename;
			this.filename = filename;
			return files[filename] ?? "";
		},
		readBinaryFile: () => [],
	});
	const link = (script: string, sink = new MemorySink(), linker = new Linker(0, fileHandler())) => {
		linker.addSegment("CODE", 0, 2);
		try {
			linker.link(script, "out.bin", new Logger({ sink, enabled: true }));
		} catch (e) {
			return e;
		}
		throw new Error("expected the link to fail");
	};

	it.each([
		// the statement's first token when there's no better one
		['.OUTPUT "x"\n  .WRITE BYTE 300', { file: "link.ld", line: 2, column: 3 }],
		// the token at fault
		['.OUTPUT "x"\n  .WRITE BYTE 1 + missing', { file: "link.ld", line: 2, column: 19 }],
		// an unknown directive
		['.OUTPUT "x"\n  .FOO 1', { file: "link.ld", line: 2, column: 4 }],
		// a statement that isn't one
		['.OUTPUT "x"\n  12', { file: "link.ld", line: 2, column: 3 }],
		// .SEGMENT(), at its name
		['.OUTPUT "x"\n  s = .SEGMENT("NOPE")', { file: "link.ld", line: 2, column: 8 }],
		// a system variable, with its token
		['.OUTPUT "x"\n  .WRITE BYTE .NOPE', { file: "link.ld", line: 2, column: 15 }],
		// an assignment, from its name
		['.OUTPUT "x"\n  a = 1 +', { file: "link.ld", line: 2, column: 9 }],
		// in an included file
		['.OUTPUT "x"\n.INCLUDE "lib.ld"', { file: "lib.ld", line: 2, column: 3 }],
		// in a macro body
		['.MACRO M\n  .WRITE BYTE 300\n.END\n.OUTPUT "x"\nM', { file: "link.ld", line: 2, column: 3 }],
	])("should report %j at its location", (script, location) => {
		const error = link(script);
		expect(error).toBeInstanceOf(AsmError);
		expect((error as AsmError).location).toEqual(location);
	});

	it.each([
		['.OUTPUT "x"\n  .FOO 1', "Syntax error - Unexpected directive 'FOO'"],
		['.OUTPUT "x"\n  12', "Syntax error - Unexpected NUMBER '12'"],
		['.OUTPUT "x"\n  s = .SEGMENT(1)', "Argument to .SEGMENT() must be a string."],
		['.OUTPUT "x"\n  s = .SEGMENT("NOPE")', "Segment 'NOPE' not found."],
		['.OUTPUT "x"\n  .WRITE BYTE .NOPE', "Unknown system variable: NOPE."],
		['.OUTPUT "x"\n  .INCLUDE 1', ".INCLUDE requires a string argument."],
	])("should not repeat the line in the message: %j", (script, message) => {
		expect((link(script) as AsmError).message).toBe(message);
	});

	it("should format as file:line:column: error: message, then the source line with a caret", () => {
		expect((link('.OUTPUT "x"\n  .WRITE BYTE 300') as AsmError).format()).toBe(
			["link.ld:2:3: error: Invalid write byte directive - 300 should be between 0 and 255", "    2 |   .WRITE BYTE 300", "      |   ^"].join("\n"),
		);
	});

	it("should say through which .INCLUDE an included file was reached", () => {
		const text = (link('.OUTPUT "x"\n.INCLUDE "lib.ld"') as AsmError).format().split("\n");
		expect(text.at(-1)).toBe("  included from link.ld:2:2");
	});

	it("should say in which macro call a macro body line was reached", () => {
		const text = (link('.MACRO M\n  .WRITE BYTE 300\n.END\n.OUTPUT "x"\nM') as AsmError).format().split("\n");
		expect(text.at(-1)).toBe("  in macro M, called at link.ld:5:1");
	});

	it("should locate an error about the whole output in the script file only", () => {
		const error = link('.OUTPUT "x" MAX 1\n.WRITE BYTE 1\n.WRITE BYTE 2') as AsmError;
		expect(error.message).toMatch(/^Output file is too large/);
		expect(error.location).toEqual({ file: "link.ld" });
	});

	it("should locate errors without a file handler, with no file", () => {
		const error = link('.OUTPUT "x"\n  .WRITE BYTE 300', undefined, new Linker(0)) as AsmError;
		expect(error.location).toEqual({ line: 2, column: 3 });
		expect(error.format()).toBe("2:3: error: Invalid write byte directive - 300 should be between 0 and 255");
	});

	it("should locate a warning like an error", () => {
		const sink = new MemorySink();
		const linker = new Linker(0, fileHandler());
		linker.addSegment("CODE", 0, 2);
		linker.link('.OUTPUT "x"\n  .WARNING "careful"', "out.bin", new Logger({ sink, enabled: true }));
		expect(sink.warnings).toEqual([["link.ld:2:3: warning: careful", '    2 |   .WARNING "careful"', "      |   ^"].join("\n")]);
	});
});
