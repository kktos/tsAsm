import { describe, expect, it } from "vitest";
import { type Block, scanBlocks } from "../../cli/format/blocks";

/** The blocks in short: `kind name line:column-line:column`, `open` when its end wasn't found. */
const blocks = (source: string) =>
	scanBlocks(source).map(
		({ kind, name, start, end, closed }: Block) =>
			`${kind}${name ? ` ${name}` : ""} ${start.line}:${start.column}-${end.line}:${end.column}${closed ? "" : " open"}`,
	);

describe("VS Code blocks", () => {
	it("reads the blocks up to their .end, nested", () => {
		expect(
			blocks(`
.macro clear addr
	.if addr > 2
		.repeat 2
			nop
		.end
	.end
.end
`),
		).toEqual(["macro clear 2:1-8:5", "if 3:2-7:6", "loop 4:3-6:7"]);
	});

	it("reads the blocks in braces, an .else's too, on one line or more", () => {
		expect(
			blocks(`
.proc main {
	.repeat 2 { nop }
	.if 1 {
		nop
	} .else {
		nop
	}
}
`),
		).toEqual(["proc main 2:1-9:2", "loop 3:2-3:19", "if 4:2-6:3", "if 6:4-8:3"]);
	});

	it("tells where an .if's .elseif and .else are, when it ends with .end", () => {
		const [outer, inner] = scanBlocks(`
.if a
	.if b
	.else
	.end
.elseif c
.else
.end
`);
		expect(outer?.branches).toEqual([
			{ line: 6, column: 1 },
			{ line: 7, column: 1 },
		]);
		expect(inner?.branches).toEqual([{ line: 4, column: 2 }]);
	});

	it("names a block where its name is, after a label too", () => {
		const [macro] = scanBlocks("start: .macro clear(a, b)\n.end\n");
		expect(macro).toMatchObject({ kind: "macro", name: "clear", nameStart: { line: 1, column: 15 }, nameEnd: { line: 1, column: 20 } });
	});

	it("ignores a directive in a comment or a string, and braces in an expression", () => {
		expect(
			blocks(`
.macro m ; .end
	x = { a: 1, b: { c: 2 } }
	.db ".end"
	/* .end */
.end
`),
		).toEqual(["macro m 2:1-6:5"]);
	});

	it("reads a function with a body as a block, not one with an expression", () => {
		expect(
			blocks(`
.function f(x) = x * 2
.function g(x)=x
.function h(x)
	.return x
.end
`),
		).toEqual(["function h 4:1-6:5"]);
	});

	it("reads a namespace up to its .end namespace, or a bare .namespace, nested", () => {
		expect(
			blocks(`
.namespace gfx
.end namespace
.namespace a
.namespace b
.namespace
.namespace c
.namespace global
`),
		).toEqual(["namespace gfx 2:1-3:15", "namespace a 4:1-6:1", "namespace b 5:1-6:1", "namespace c 7:1-8:1"]);
	});

	it("closes a namespace opened in a block at the block's end", () => {
		expect(
			blocks(`
.proc p
.namespace inner
.end
`),
		).toEqual(["proc p 2:1-4:5", "namespace inner 3:1-4:5"]);
	});

	it("reads a .segment as a selection, its braces as its definition", () => {
		expect(
			blocks(`
.segment CODE { start: $0800, size: 0 }
.segment DATA {
	start: $2000, size: $100
}
.segment CODE
`),
		).toEqual(["segment CODE 2:1-2:40", "segment DATA 3:1-5:2", "segment CODE 6:1-6:14"]);
	});

	it("reads the raw blocks of .define and .hex up to their .end line, and skips their text", () => {
		expect(
			blocks(`
.define sprites
  - { id: 1 }
  - .end is not here
.end
.define table AS JSON
  [1, 2]
.end
.define t [1, 2]
.define levels from "levels.yml"
.define o { "a": 1 }
.hex
  01 02
.end
.hex 03 04
`),
		).toEqual(["define sprites 2:1-5:5", "define table 6:1-8:5", "define t 9:1-9:17", "define o 11:1-11:21", "hex 12:1-14:5", "hex 15:1-15:11"]);
	});

	it("reads a struct up to its .end or its closing brace, with its name", () => {
		expect(
			blocks(`
.struct Sprite
	x .byte
.end
.struct Point { x .byte }
`),
		).toEqual(["struct Sprite 2:1-4:5", "struct Point 5:1-5:26"]);
	});

	it("runs a block without its end to the end of the file", () => {
		expect(blocks(".proc p\n\tnop\n")).toEqual(["proc p 1:1-2:5 open"]);
	});
});
