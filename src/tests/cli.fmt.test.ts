import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFmtArgs, runFmt } from "../cli/fmt";

const KEYS = `indent_style = tab
tab_width = 4
tsasm_opcode_column = 8
tsasm_operand_column = 16
tsasm_comment_column = 40
tsasm_indent_blocks = true
`;

const PROJECT = `
input:
  cpu: 6502
  source: src/main.asm
  segments:
    - { name: CODE, start: 0x1000, size: 0x100 }
`;

const MACROS = `.macro init v
 lda #v
.end
`;

describe("tsasm fmt's arguments", () => {
	it("takes a project file, --check or --init", () => {
		expect(parseFmtArgs(["game.yaml"])).toEqual({ projectFile: "game.yaml", check: false, init: false });
		expect(parseFmtArgs(["--check", "game.yaml"])).toEqual({ projectFile: "game.yaml", check: true, init: false });
		expect(parseFmtArgs(["game.yaml", "--init"])).toEqual({ projectFile: "game.yaml", check: false, init: true });
		expect(parseFmtArgs(["--help"])).toBeUndefined();
	});

	it("is an error without a project file, with two, with an unknown option, with --check and --init", () => {
		expect(parseFmtArgs([])).toEqual(["Missing the project file: tsasm fmt <project-file>."]);
		expect(parseFmtArgs(["a.yaml", "b.yaml"])).toEqual(["Unexpected argument: b.yaml. The project file is already 'a.yaml'."]);
		expect(parseFmtArgs(["--fix", "a.yaml"])).toEqual(["Unknown option for fmt: --fix. The options are --check and --init."]);
		expect(parseFmtArgs(["--check", "--init", "a.yaml"])).toEqual(["--check and --init can't be given together: --init writes the .editorconfig."]);
	});
});

describe("tsasm fmt", () => {
	let dir: string;
	let logs: string[];
	let errors: string[];
	const output = { log: (message: string) => logs.push(message), error: (message: string) => errors.push(message) };
	const fmt = (options: { check?: boolean; init?: boolean } = {}) =>
		runFmt({ projectFile: join(dir, "game.yaml"), check: options.check ?? false, init: options.init ?? false }, output);
	const read = (file: string) => readFileSync(join(dir, file), "utf8");
	const write = (file: string, text: string) => writeFileSync(join(dir, file), text);

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "tsasm-fmt-"));
		mkdirSync(join(dir, "src"));
		vi.spyOn(process, "cwd").mockReturnValue(dir);
		logs = [];
		errors = [];
		write("game.yaml", PROJECT);
		write("src/macros.inc", MACROS);
		write("src/levels.yaml", "- 1\n- 2\n");
		write(
			"src/main.asm",
			`.include "macros.inc"
.define LEVELS from "levels.yaml"
start: init $10
init $20
 lda #0 ; load
`,
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
	});

	it("stops on a file no .editorconfig gives its settings, naming the keys", () => {
		expect(fmt()).toBe(1);
		expect(errors).toEqual([
			"src/macros.inc: no .editorconfig sets indent_style, tab_width, tsasm_opcode_column, tsasm_operand_column, tsasm_comment_column, tsasm_indent_blocks for it: tsasm fmt --init adds them.",
			"src/main.asm: no .editorconfig sets indent_style, tab_width, tsasm_opcode_column, tsasm_operand_column, tsasm_comment_column, tsasm_indent_blocks for it: tsasm fmt --init adds them.",
		]);
		expect(read("src/main.asm")).toMatch(/^\.include/);
	});

	it("--init adds the keys for the files the project reads statements from, once", () => {
		expect(fmt({ init: true })).toBe(0);
		expect(read(".editorconfig")).toBe(`[*.{asm,inc}]\n${KEYS}`);
		expect(logs).toEqual([".editorconfig: the format keys added."]);
		expect(fmt({ init: true })).toBe(0);
		expect(logs.at(-1)).toBe("Nothing to add: the .editorconfig sets every key for the project's files.");
	});

	it("formats the files the project reads statements from, with its CPU and the macros of its includes", () => {
		write(".editorconfig", `[*]\n${KEYS}`);
		expect(fmt()).toBe(0);
		// `init`, a macro of the included file, starts a statement at the line's start.
		expect(read("src/main.asm")).toBe(`\t\t.include\t"macros.inc"
\t\t.define\tLEVELS from "levels.yaml"
start:\tinit\t$10
\t\tinit\t$20
\t\tlda\t\t#0\t\t\t\t\t\t; load
`);
		expect(read("src/macros.inc")).toBe("\t\t.macro\tinit v\n\t\t\tlda\t\t#v\n\t\t.end\n");
		// The data a .define reads isn't a source.
		expect(read("src/levels.yaml")).toBe("- 1\n- 2\n");
		expect(logs).toEqual(["src/macros.inc: formatted", "src/main.asm: formatted", "2 files formatted, 0 files unchanged."]);
	});

	it("--check writes nothing, lists each file not formatted at its first line that changes, and fails", () => {
		write(".editorconfig", `[*]\n${KEYS}`);
		write("src/macros.inc", "\t\t.macro\tinit v\n\t\t\tlda\t\t#v\n.end\n");
		expect(fmt({ check: true })).toBe(1);
		expect(logs).toEqual(["src/macros.inc:3: not formatted", "src/main.asm:1: not formatted", "2 files not formatted, 0 files formatted."]);
		expect(read("src/macros.inc")).toBe("\t\t.macro\tinit v\n\t\t\tlda\t\t#v\n.end\n");
		fmt();
		logs = [];
		expect(fmt({ check: true })).toBe(0);
		expect(logs).toEqual(["0 files not formatted, 2 files formatted."]);
	});

	it("keeps a file's line endings and byte order mark, and its date when nothing changes", () => {
		write(".editorconfig", `[*]\n${KEYS}`);
		write("src/main.asm", '﻿.include "macros.inc"\r\n lda #0\r\n');
		expect(fmt()).toBe(0);
		expect(read("src/main.asm")).toBe('﻿\t\t.include\t"macros.inc"\r\n\t\tlda\t\t#0\r\n');
		const old = new Date(2020, 0, 1);
		utimesSync(join(dir, "src/main.asm"), old, old);
		expect(fmt()).toBe(0);
		expect(statSync(join(dir, "src/main.asm")).mtime).toEqual(old);
	});

	it("formats nothing when the project doesn't assemble", () => {
		write(".editorconfig", `[*]\n${KEYS}`);
		write("src/main.asm", " lda #0\n jmp nowhere\n");
		expect(fmt()).toBe(1);
		expect(errors.at(-1)).toBe("Not formatted: the project doesn't assemble.");
		expect(read("src/main.asm")).toBe(" lda #0\n jmp nowhere\n");
	});

	it("is an error for a bad .editorconfig value, at its file and line", () => {
		write(".editorconfig", `[*]\n${KEYS}tsasm_opcode_column = abc\n`);
		expect(fmt()).toBe(1);
		// Told once, for the two files.
		expect(errors).toEqual([".editorconfig:8: tsasm_opcode_column = abc: a column is a whole number, from 0."]);
		expect(logs).toEqual(["0 files formatted, 0 files unchanged, 2 files in error."]);
	});
});
