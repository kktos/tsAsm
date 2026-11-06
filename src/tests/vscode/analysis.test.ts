import { describe, expect, it } from "vitest";
import { analyse, isProjectFile, tokenSpan } from "../../vscode/analysis";

const PROJECT = `
input:
  source: src/main.asm
`;

/** The project in `/p/proj.yaml`, its files in memory: a missing one throws as the disk does. */
function analyseFiles(files: Record<string, string>) {
	return analyse("/p/proj.yaml", {
		readText(path) {
			const text = files[path];
			if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
			return text;
		},
		readBytes(path) {
			return [...this.readText(path)].map((char) => char.charCodeAt(0));
		},
	});
}

describe("VS Code analysis", () => {
	it("assembles a project without a diagnostic, and lists the files it read", () => {
		const analysis = analyseFiles({
			"/p/proj.yaml": PROJECT,
			"/p/src/main.asm": `
start:
	.include "lib/sub.asm"
	.incbin "data.bin"
`,
			"/p/src/lib/sub.asm": `
	lda #1
`,
			"/p/src/data.bin": "AB",
		});
		expect(analysis.diagnostics).toEqual([]);
		expect([...analysis.files]).toEqual(["/p/proj.yaml", "/p/src/main.asm", "/p/src/lib/sub.asm", "/p/src/data.bin"]);
	});

	it("reports an error at its token, with the note at the first definition", () => {
		const { diagnostics } = analyseFiles({
			"/p/proj.yaml": PROJECT,
			"/p/src/main.asm": `
start:
	nop
start:
`,
		});
		expect(diagnostics).toEqual([
			{
				file: "/p/src/main.asm",
				line: 4,
				column: 1,
				endColumn: 6,
				message: "Symbol 'START' redefined.",
				severity: "error",
				related: [{ file: "/p/src/main.asm", line: 2, column: 1, endColumn: 6, message: "first defined here" }],
			},
		]);
	});

	it("reports an error in an included file there, with the .include that led to it", () => {
		const { diagnostics } = analyseFiles({
			"/p/proj.yaml": PROJECT,
			"/p/src/main.asm": `
	nop
	.include "lib/sub.asm"
`,
			"/p/src/lib/sub.asm": `
	lda @x
`,
		});
		expect(diagnostics).toEqual([
			{
				file: "/p/src/lib/sub.asm",
				line: 2,
				column: 6,
				endColumn: 8,
				message: "Unexpected character '@' (U+0040).",
				severity: "error",
				related: [{ file: "/p/src/main.asm", line: 3, column: 2, endColumn: 10, message: "included here" }],
			},
		]);
	});

	it("reports an error in a macro body in the macro's file, with the call that led to it", () => {
		const { diagnostics } = analyseFiles({
			"/p/proj.yaml": PROJECT,
			"/p/src/main.asm": `
	.include "macros.asm"
	clear
`,
			"/p/src/macros.asm": `
.macro clear
	lda foo
.end
`,
		});
		expect(diagnostics).toEqual([
			{
				file: "/p/src/macros.asm",
				line: 3,
				column: 6,
				endColumn: 9,
				message: "Undefined symbol 'FOO'.",
				severity: "error",
				related: [{ file: "/p/src/main.asm", line: 3, column: 2, endColumn: 7, message: "in macro clear, called here" }],
			},
		]);
	});

	it("reports the warnings, and the error that stopped the assembly", () => {
		const { diagnostics } = analyseFiles({
			"/p/proj.yaml": PROJECT,
			"/p/src/main.asm": `
	.option foo 1
	.assert 0, warn, "careful"
	lda bar
`,
		});
		expect(diagnostics.map(({ line, column, endColumn, severity, message }) => ({ line, column, endColumn, severity, message }))).toEqual([
			{ line: 4, column: 6, endColumn: 9, severity: "error", message: "Undefined symbol 'BAR'." },
			{ line: 2, column: 2, endColumn: 9, severity: "warning", message: "Unknown option 'foo'." },
			{ line: 3, column: 2, endColumn: 9, severity: "warning", message: "careful" },
		]);
	});

	it("reports a warning in a macro body once, with each call that gave it", () => {
		const { diagnostics } = analyseFiles({
			"/p/proj.yaml": PROJECT,
			"/p/src/main.asm": `
.macro careful
	.warning "careful"
.end
	careful
	careful
`,
		});
		expect(diagnostics).toEqual([
			{
				file: "/p/src/main.asm",
				line: 3,
				column: 2,
				endColumn: 10,
				message: "careful",
				severity: "warning",
				related: [
					{ file: "/p/src/main.asm", line: 5, column: 2, endColumn: 9, message: "in macro careful, called here" },
					{ file: "/p/src/main.asm", line: 6, column: 2, endColumn: 9, message: "in macro careful, called here" },
				],
			},
		]);
	});

	it("lists a missing included file, so creating it assembles again", () => {
		const analysis = analyseFiles({
			"/p/proj.yaml": PROJECT,
			"/p/src/main.asm": `
	.include "missing.asm"
`,
		});
		expect(analysis.files.has("/p/src/missing.asm")).toBe(true);
		expect(analysis.diagnostics).toMatchObject([
			{ file: "/p/src/main.asm", line: 2, severity: "error", message: expect.stringMatching(/^Can't include 'missing.asm': ENOENT/) },
		]);
	});
});

describe("VS Code analysis of the project file", () => {
	it("reports a missing source at its setting", () => {
		const { diagnostics } = analyseFiles({ "/p/proj.yaml": PROJECT });
		expect(diagnostics).toMatchObject([
			{ file: "/p/proj.yaml", line: 3, severity: "error", message: expect.stringMatching(/^Can't read the source 'src\/main.asm': ENOENT/) },
		]);
	});

	it("reports a YAML error at its line", () => {
		const { diagnostics } = analyseFiles({
			"/p/proj.yaml": `
input:
  source: [
`,
		});
		expect(diagnostics).toMatchObject([{ file: "/p/proj.yaml", line: 4, severity: "error" }]);
	});

	it("reports a setting the schema refuses at its key", () => {
		const { diagnostics } = analyseFiles({
			"/p/proj.yaml": `
input:
  source: main.asm
  cpu: z80
`,
			"/p/main.asm": `
	nop
`,
		});
		expect(diagnostics).toMatchObject([{ file: "/p/proj.yaml", line: 4, severity: "error", message: expect.stringMatching(/^input.cpu: Invalid cpu/) }]);
	});

	it("reports a segment the assembler refuses in the project file", () => {
		const { diagnostics } = analyseFiles({
			"/p/proj.yaml": `
input:
  source: main.asm
  segments:
    - name: A
      size: 5
`,
			"/p/main.asm": `
	nop
`,
		});
		expect(diagnostics).toMatchObject([
			{ file: "/p/proj.yaml", severity: "error", message: "Segment 'A' needs a 'start' address, or 'relocatable: true'." },
		]);
	});

	it("tells a project file by its input.source", () => {
		expect(isProjectFile(PROJECT)).toBe(true);
		expect(isProjectFile("input:\n  cpu: 6502\n")).toBe(false);
		expect(isProjectFile("- a\n- b\n")).toBe(false);
		expect(isProjectFile("input: [\n")).toBe(false);
	});
});

describe("VS Code token spans", () => {
	it("covers the token at a column: a name without its label colon, a string, one char at an operator", () => {
		expect(tokenSpan("start: lda #1", 1)).toEqual([1, 6]);
		expect(tokenSpan(":loop bne :loop", 1)).toEqual([1, 6]);
		expect(tokenSpan('\t.include "a b.asm"', 11)).toEqual([11, 20]);
		expect(tokenSpan("\tlda #1+2", 7)).toEqual([7, 8]);
		expect(tokenSpan("\tlda #1+2", 8)).toEqual([8, 9]);
	});

	it("covers the line but its indentation without a column", () => {
		expect(tokenSpan("\tlda #1  ", undefined)).toEqual([2, 8]);
		expect(tokenSpan("", undefined)).toEqual([1, 2]);
	});
});
