import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyse } from "../../vscode/analysis";
import { buildGrammar } from "../../vscode/grammar";
import { semanticTokens, TOKEN_MODIFIERS, TOKEN_TYPES } from "../../vscode/semantic";
import type { SymbolIndex } from "../../vscode/symbol-index";

const PROJECT = `
input:
  source: main.asm
  segments:
    - { name: CODE, start: 0x1000, size: 0x100 }
`;

/** The tokens of `main` assembled, in short: `line:column text type modifiers`. */
function tokens(main: string, index?: SymbolIndex): string[] {
	const texts: Record<string, string> = { "/p/proj.yaml": PROJECT, "/p/main.asm": main };
	const analysis = analyse("/p/proj.yaml", { readText: (path) => texts[path] as string, readBytes: () => [] });
	const entries = (index ?? (analysis.index as SymbolIndex)).entriesIn("/p/main.asm");
	const lines = main.split("\n");
	return semanticTokens(entries, main).map(({ line, column, length, type, modifiers }) =>
		[`${line}:${column}`, lines[line - 1]?.slice(column - 1, column - 1 + length), type, ...modifiers].join(" "),
	);
}

describe("VS Code semantic tokens", () => {
	it("tells each name as the assembler made it, its definition marked", () => {
		expect(
			tokens(`
HEIGHT .equ 25
count = 1
start:	lda #HEIGHT
	ldx #count
	jmp start
`),
		).toEqual([
			"2:1 HEIGHT variable declaration readonly",
			"3:1 count variable declaration",
			"4:1 start label declaration",
			"4:13 HEIGHT variable readonly",
			"5:7 count variable",
			"6:6 start label",
		]);
	});

	it("tells a local label with the prefix the file sets, and an anonymous one", () => {
		expect(
			tokens(`
	.option local.prefix "!"
start:
!loop	dex
	bne !loop
:	bne :-
`),
		).toEqual([
			"3:1 start label declaration",
			"4:1 !loop label declaration local",
			"5:6 !loop label local",
			"6:1 : label declaration anonymous",
			"6:7 :- label anonymous",
		]);
	});

	it("tells a macro, a function and its parameter", () => {
		expect(
			tokens(`
.macro clear addr
	nop
.end
	.function double(x) = x * 2
	clear 1
	.db double(3)
`),
		).toEqual(["2:8 clear macro declaration", "5:12 double function declaration", "5:24 x parameter", "6:2 clear macro", "7:6 double function"]);
	});

	it("colours a qualified name's name, not its namespace, and not a name built by an expression", () => {
		expect(
			tokens(`
.namespace gfx
sprite:	rts
.end namespace
	jsr gfx::sprite
	.let "pos" + "X" = 1
	.db posX
`),
		).toEqual(["3:1 sprite label declaration", "5:11 sprite label", "7:6 posX variable"]);
	});
});

describe("VS Code semantic token scopes", () => {
	const manifest = JSON.parse(readFileSync("editors/vscode/package.json", "utf-8"));
	const contributes = manifest.contributes;
	const grammar = JSON.stringify(buildGrammar());

	it("maps each type, with the legend's modifiers, to a scope of the grammar", () => {
		const [{ language, scopes }] = contributes.semanticTokenScopes;
		expect(language).toBe("tsasm");
		for (const [selector, [scope]] of Object.entries(scopes as Record<string, string[]>)) {
			const [type, ...modifiers] = selector.split(".");
			expect(TOKEN_TYPES, selector).toContain(type);
			for (const modifier of modifiers) expect(TOKEN_MODIFIERS, selector).toContain(modifier);
			expect(grammar, selector).toContain(`"${scope}"`);
		}
		for (const type of TOKEN_TYPES) expect(Object.keys(scopes)).toContain(type);
	});

	it("declares the modifiers VS Code doesn't have", () => {
		expect(contributes.semanticTokenModifiers.map(({ id }: { id: string }) => id)).toEqual(["local", "anonymous"]);
	});
});
