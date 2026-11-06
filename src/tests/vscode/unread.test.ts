import { describe, expect, it } from "vitest";
import { analyse } from "../../vscode/analysis";
import type { Place } from "../../vscode/places";
import type { SymbolIndex } from "../../vscode/symbol-index";
import { commonRuns } from "../../vscode/unread";

const PROJECT = `
input:
  source: main.asm
  segments:
    - { name: CODE, start: 0x1000, size: 0x100 }
`;

const MAIN = `
.macro used
	nop
.end
.macro unused
	inx
	; not called

	iny
.end
.function never(x) {
	.return x
}
.if 1
	used
.else
	lda #2
.end
.if 0 {
	ldx #1
} .else {
	ldx #2
}
.repeat 0
	nop
.end
.hex
	01 02
.end
	.include "lib.asm"
`;

const LIB = `.if 0
	brk
.end
	rts
`;

function indexOf(main = MAIN) {
	const texts: Record<string, string> = { "/p/proj.yaml": PROJECT, "/p/main.asm": main, "/p/lib.asm": LIB };
	const analysis = analyse("/p/proj.yaml", { readText: (path) => texts[path] as string, readBytes: () => [] });
	expect(analysis.diagnostics).toEqual([]);
	return analysis.index as SymbolIndex;
}

/** The runs of lines not read in `file`, `start-end`. */
const runs = (index: SymbolIndex, file = "/p/main.asm") =>
	commonRuns([index.unreadIn(file)]).map(({ start, end }) => (start === end ? `${start}` : `${start}-${end}`));

describe("VS Code code not read", () => {
	it("is a branch not taken, a macro's or a function's body never called, a .repeat 0's, comments between included", () => {
		expect(runs(indexOf())).toEqual(["6-9", "12", "17", "20", "25"]);
	});

	it("keeps a read block's .end, .else, braces and raw text, and an included file's own", () => {
		const index = indexOf();
		const unread = index.unreadIn("/p/main.asm").map(({ line }) => line);
		for (const line of [4, 10, 13, 16, 18, 21, 23, 26, 27, 28, 29]) expect(unread).not.toContain(line);
		expect(runs(index, "/p/lib.asm")).toEqual(["2"]);
	});

	it("covers a run's whole lines, and follows the edits since the assembly", () => {
		const index = indexOf();
		expect(commonRuns([index.unreadIn("/p/main.asm")])[0]).toEqual({ start: 6, end: 9, endColumn: 5 });
		// A line inserted at the top moves them; an edit on one shows it read until the next assembly.
		index.shift("/p/main.asm", { start: { line: 1, column: 1 }, end: { line: 1, column: 1 }, text: "\n" });
		expect(runs(index)).toEqual(["7-10", "13", "18", "21", "26"]);
		index.shift("/p/main.asm", { start: { line: 13, column: 2 }, end: { line: 13, column: 2 }, text: "x" });
		expect(runs(index)).toEqual(["7-10", "18", "21", "26"]);
	});

	it("fades a line of a file in two projects only when neither read it", () => {
		const line = (n: number): Place => ({ file: "/p/lib.asm", line: n, column: 1, endColumn: 4 });
		expect(
			commonRuns([
				[line(2), line(3), line(5)],
				[line(3), line(5), line(6)],
			]),
		).toEqual([
			{ start: 3, end: 3, endColumn: 4 },
			{ start: 5, end: 5, endColumn: 4 },
		]);
		expect(commonRuns([[line(2), line(3)]])).toEqual([{ start: 2, end: 3, endColumn: 4 }]);
		expect(commonRuns([[line(2)], []])).toEqual([]);
		expect(commonRuns([])).toEqual([]);
	});
});
