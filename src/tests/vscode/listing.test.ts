import { describe, expect, it } from "vitest";
import { analyse } from "../../vscode/analysis";
import { listingLineOf, listingText } from "../../vscode/listing";
import type { SymbolIndex } from "../../vscode/symbol-index";

const project = (output = "") => `
input:
  source: main.asm
  segments:
    - { name: CODE, start: 0x1000, size: 0x100 }
${output}`;

const MAIN = `
.macro clear addr
	lda #0
	sta addr
.end
; the start
start:
	clear $10
	.include "lib.asm"
	nop
`;

const LIB = `sub:	rts
`;

function analysed(main = MAIN, output = "") {
	const texts: Record<string, string> = { "/p/proj.yaml": project(output), "/p/main.asm": main, "/p/lib.asm": LIB };
	const analysis = analyse("/p/proj.yaml", { readText: (path) => texts[path] as string, readBytes: () => [] });
	expect(analysis.diagnostics).toEqual([]);
	return { analysis, index: analysis.index as SymbolIndex };
}

/** The listing's line for `line` of `file`, its spaces squeezed, `~` when it's the closest above's. */
function shown(index: SymbolIndex, line: number, file = "/p/main.asm"): string | undefined {
	const at = listingLineOf(index.listing, file, line);
	if (!at) return undefined;
	const text = (index.listing[at.index]?.text ?? "").trim().replace(/\s+/g, " ");
	return at.exact ? text : `~ ${text}`;
}

describe("VS Code listing", () => {
	it("is the CLI's pass 2 listing, named as the CLI names it", () => {
		const { analysis, index } = analysed();
		const text = listingText(index.listing);
		expect(text.split("\n").map((line) => line.trim().replace(/\s+/g, " "))).toEqual([
			".set namespace: global",
			"1000 start:",
			"clear(16)",
			"1000: A9 00 LDA #$00",
			"1002: 85 10 STA ADDR",
			'.include "lib.asm"',
			"1004 sub:",
			"1004: 60 RTS",
			"1005: EA NOP",
		]);
		expect(text).not.toMatch(/ $/m);
		expect(analysis.listingPath).toBe("/p/main.asm.lst");
		expect(analysed(MAIN, "output:\n  listing:\n    path: out/prog.lst\n").analysis.listingPath).toBe("/p/out/prog.lst");
	});

	it("ties a source line to its first listing line: a macro call's, its body's, an .include's, the included file's", () => {
		const { index } = analysed();
		expect(shown(index, 7)).toBe("1000 start:");
		expect(shown(index, 8)).toBe("clear(16)");
		expect(shown(index, 3)).toBe("1000: A9 00 LDA #$00");
		expect(shown(index, 9)).toBe('.include "lib.asm"');
		expect(shown(index, 1, "/p/lib.asm")).toBe("1004 sub:");
		expect(shown(index, 10)).toBe("1005: EA NOP");
	});

	it("gives a line that listed nothing the closest line above's, not highlighted; nothing above the first", () => {
		const { index } = analysed();
		expect(shown(index, 11)).toBe("~ 1005: EA NOP");
		expect(shown(index, 6)).toBe("~ 1002: 85 10 STA ADDR");
		expect(shown(index, 1)).toBeUndefined();
	});

	it("follows the edits since the assembly", () => {
		const { index } = analysed();
		// A line inserted above `nop`, line 10.
		index.shift("/p/main.asm", { start: { line: 10, column: 1 }, end: { line: 10, column: 1 }, text: "\tinx\n" });
		expect(shown(index, 11)).toBe("1005: EA NOP");
		expect(shown(index, 10)).toBe('~ .include "lib.asm"');
	});
});
