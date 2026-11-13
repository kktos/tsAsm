import { describe, expect, it } from "vitest";
import { scanBlocks } from "../../format/blocks";
import { foldingRanges } from "../../vscode/folding";

/** The folds of `source` in short: `start-end`, and their kind; `labels` the lines of its global labels. */
const folds = (source: string, labels: number[] = []) =>
	foldingRanges(source, scanBlocks(source), labels).map(({ start, end, kind }) => `${start}-${end}${kind ? ` ${kind}` : ""}`);

describe("VS Code folding", () => {
	it("folds a block written flat up to its .end, which stays shown", () => {
		expect(
			folds(`
.macro clear addr
lda #0
sta addr
.end
`),
		).toEqual(["2-4"]);
	});

	it("folds nested blocks, braces, and a block without its end to the file's end", () => {
		expect(
			folds(`
.proc main {
	.repeat 2 { nop }
	.for i of [1, 2]
		nop
	.end
}
.function f(x)
	.return x
`),
		).toEqual(["2-6", "4-5", "8-9"]);
	});

	it("folds each branch of an .if", () => {
		expect(
			folds(`
.if a
	nop
.elseif b
	nop
.else
	nop
.end
.if c {
	nop
} .else {
	nop
}
`),
		).toEqual(["2-3", "4-5", "6-7", "9-10", "11-12"]);
	});

	it("folds the raw blocks of .define and .hex, not a .segment", () => {
		expect(
			folds(`
.segment CODE
.define sprites
  - { id: 1 }
.end
.hex
  01 02
.end
`),
		).toEqual(["3-4", "6-7"]);
	});

	it("folds a routine from its global label up to the next, its trailing comments the next one's", () => {
		expect(
			folds(
				`
clear:
	lda #0
	rts

; fills the screen
fill:
	lda #1
	rts
`,
				[2, 7],
			),
		).toEqual(["2-4", "7-9"]);
	});

	it("stops a routine at a block holding code, at the end or the next branch of the block it's in", () => {
		expect(
			folds(
				`
start:
	rts
.macro m
inner:
	nop
.end
.if 1
first:
	nop
.else
second:
	nop
.end
`,
				[2, 5, 9, 12],
			),
		).toEqual(["2-3", "4-6", "5-6", "8-10", "9-10", "11-13", "12-13"]);
	});

	it("folds a proc once, its label being the block's", () => {
		expect(folds(".proc init\n\tnop\n\trts\n.end\n", [1])).toEqual(["1-3"]);
	});

	it("folds the runs of comment lines, and the regions", () => {
		expect(
			folds(`
; a header
; on two lines
	nop ; not a comment line
/* a block
   comment */
; region tables
	.db 1
; endregion
; one line
`),
		).toEqual(["2-3 comment", "5-6 comment", "7-9 region"]);
	});
});
