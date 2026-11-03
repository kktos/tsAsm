import { describe, expect, it } from "vitest";
import { findFileLinks } from "../../vscode/links";

/** The paths found, each with the source text its link covers. */
const links = (source: string) => findFileLinks(source).map(({ start, end, path }) => ({ text: source.slice(start, end), path }));

describe("VS Code links", () => {
	it("links the path of .include, .incbin and .define … from", () => {
		const source = `
.include "boot/loader.asm"  ; assemble another source file here
.incbin "data/logo.bin"
.define levels from "levels.yml"
.define table AS JSON FROM 'table.json'
`;
		expect(links(source)).toEqual([
			{ text: "boot/loader.asm", path: "boot/loader.asm" },
			{ text: "data/logo.bin", path: "data/logo.bin" },
			{ text: "levels.yml", path: "levels.yml" },
			{ text: "table.json", path: "table.json" },
		]);
	});

	it("finds them in any case, after a label or a brace", () => {
		const source = `
start: .INCLUDE "a.asm"
exit .Include "b.asm"
.if DEBUG { .include "c.asm" }
`;
		expect(links(source).map(({ path }) => path)).toEqual(["a.asm", "b.asm", "c.asm"]);
	});

	it("reads the escapes of the string", () => {
		expect(links(`.include "a\\"b\\\\c\\x41.asm"`)).toEqual([{ text: `a\\"b\\\\c\\x41.asm`, path: `a"b\\cA.asm` }]);
	});

	it("doesn't link a path built by an expression", () => {
		const source = `
.include "gfx/" + name
.include name
.incbin .str(n) + ".bin"
`;
		expect(links(source)).toEqual([]);
	});

	it("doesn't link a path in a comment", () => {
		const source = `
; .include "a.asm"
// .include "b.asm"
/* .include "c.asm"
.include "d.asm" */
    nop ; .include "e.asm"
.include "f.asm"
`;
		expect(links(source).map(({ path }) => path)).toEqual(["f.asm"]);
	});

	it("doesn't take a ; in a string for a comment", () => {
		expect(links(`.include "a;b.asm" ; the file`).map(({ path }) => path)).toEqual(["a;b.asm"]);
		expect(links(`.text "; .include"\n.include "a.asm"`).map(({ path }) => path)).toEqual(["a.asm"]);
	});

	it("doesn't link a directive that isn't a statement's", () => {
		expect(links(`.log ".include \\"a.asm\\""`)).toEqual([]);
	});
});
