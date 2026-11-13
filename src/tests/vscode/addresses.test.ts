import { describe, expect, it } from "vitest";
import { scanBlocks } from "../../format/blocks";
import { lineHints } from "../../vscode/addresses";
import { analyse } from "../../vscode/analysis";
import type { SymbolIndex } from "../../vscode/symbol-index";

const PROJECT = `
input:
  source: main.asm
  segments:
    - { name: CODE, start: 0x1000, size: 0x100 }
`;

function indexOf(main: string, others: Record<string, string> = {}): SymbolIndex {
	const texts: Record<string, string> = { "/p/proj.yaml": PROJECT, "/p/main.asm": main };
	for (const [name, text] of Object.entries(others)) texts[`/p/${name}`] = text;
	const analysis = analyse("/p/proj.yaml", { readText: (path) => texts[path] as string, readBytes: () => [] });
	expect(analysis.diagnostics).toEqual([]);
	return analysis.index as SymbolIndex;
}

/** The hints of a file, in short: `line: text (tooltip)`. */
function hints(index: SymbolIndex, text: string, file = "/p/main.asm"): string[] {
	return lineHints(index.hintsIn(file), scanBlocks(text)).map(({ line, text: hint, tooltip }) => `${line}: ${hint} (${tooltip})`);
}

describe("VS Code addresses", () => {
	it("gives each line its address, its bytes in the tooltip, a label alone its own", () => {
		const main = `
start:
	lda #1
	.db 2, 3
count = 4
:	nop
`;
		expect(hints(indexOf(main), main)).toEqual(["2: $1000 (A label's address.)", "3: $1000 (A9 01)", "4: $1002 (02 03)", "6: $1004 (EA)"]);
	});

	it("gives a macro body's line its first address and its runs, a call the first address of what it assembled", () => {
		const main = `
.macro clear
	lda #0
	sta $10
.end
	clear
	clear
`;
		expect(hints(indexOf(main), main)).toEqual([
			"3: $1000 ×2 (4 bytes in 2 runs.)",
			"4: $1002 ×2 (4 bytes in 2 runs.)",
			"6: $1000 (4 bytes.)",
			"7: $1004 (4 bytes.)",
		]);
	});

	it("gives an .include the first address of its file, and the included file's lines theirs", () => {
		const main = `
	nop
	.include "lib.asm"
`;
		const index = indexOf(main, { "lib.asm": "\tlda #1\n\trts\n" });
		expect(hints(index, main)).toEqual(["2: $1000 (EA)", "3: $1001 (3 bytes.)"]);
		expect(hints(index, "\tlda #1\n\trts\n", "/p/lib.asm")).toEqual(["1: $1001 (A9 01)", "2: $1003 (60)"]);
	});

	it("gives a loop's body its runs, and its header the first address of its body", () => {
		const main = `
	.repeat 3
	nop
	.db 1
	.end
`;
		expect(hints(indexOf(main), main)).toEqual(["2: $1000 (6 bytes in all.)", "3: $1000 ×3 (3 bytes in 3 runs.)", "4: $1001 ×3 (3 bytes in 3 runs.)"]);
	});

	it("moves the addresses with the edits, and drops a statement's an edit touches", () => {
		const main = `
	lda #1
	nop
`;
		const index = indexOf(main);
		index.shift("/p/main.asm", { start: { line: 1, column: 1 }, end: { line: 1, column: 1 }, text: "; header\n" });
		index.shift("/p/main.asm", { start: { line: 4, column: 2 }, end: { line: 4, column: 5 }, text: "rts" });
		expect(hints(index, `; header\n${main}`)).toEqual(["3: $1000 (A9 01)"]);
	});
});
