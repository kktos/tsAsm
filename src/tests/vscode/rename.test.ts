import { describe, expect, it } from "vitest";
import { analyse, type Files } from "../../vscode/analysis";
import { applyEdits, readText, renameProjects, renameSymbol } from "../../vscode/rename";
import type { SymbolIndex } from "../../vscode/symbol-index";

const PROJECT = `
input:
  source: main.asm
  segments:
    - { name: CODE, start: 0x1000, size: 0x100 }
`;

const relative = (file: string) => file.replace("/p/", "");

/**
 * Renames the name at `line` and `column` of main.asm to `typed`, as F2 does: the files it changes, by name, their
 * edits to confirm (in what the assembly didn't read) in «».
 */
function rename(main: string, line: number, column: number, typed: string, others: Record<string, string> = {}): Record<string, string> {
	const texts: Record<string, string> = { "/p/proj.yaml": PROJECT, "/p/main.asm": main };
	for (const [name, text] of Object.entries(others)) texts[`/p/${name}`] = text;
	const files: Files = {
		readText(path) {
			const text = texts[path];
			if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
			return text;
		},
		readBytes: () => [],
	};
	const analysis = analyse("/p/proj.yaml", files);
	const index = analysis.index as SymbolIndex;
	const symbol = renameSymbol([index], index.at("/p/main.asm", line, column), column, (path) => readText(files, path), relative);
	const edits = renameProjects([{ path: "/p/proj.yaml", index, sources: analysis.sources }], symbol, typed, files, relative);
	const renamed: Record<string, string> = {};
	for (const file of new Set(edits.map(({ place }) => place.file))) {
		const own = edits.filter(({ place }) => place.file === file).map((edit) => (edit.unread ? { ...edit, text: `«${edit.text}»` } : edit));
		renamed[relative(file)] = applyEdits(texts[file] as string, own);
	}
	return renamed;
}

describe("VS Code rename", () => {
	it("renames a label at its definition and its references, a qualified one's name only, as typed", () => {
		const main = `
.namespace gfx
sprite: rts
	jmp SPRITE
.end namespace
	jsr gfx::sprite
`;
		expect(rename(main, 3, 1, "draw")).toEqual({
			"main.asm": `
.namespace gfx
draw: rts
	jmp draw
.end namespace
	jsr gfx::draw
`,
		});
	});

	it("renames from a reference, in every file", () => {
		const main = `
	.include "lib.asm"
	jsr clear
	jmp clear
`;
		expect(rename(main, 3, 7, "erase", { "lib.asm": "clear:\trts\n" })).toEqual({
			"main.asm": `
	.include "lib.asm"
	jsr erase
	jmp erase
`,
			"lib.asm": "erase:\trts\n",
		});
	});

	it("renames a local label after its prefix, the new name typed with it or not", () => {
		const main = `
start:
:loop	dex
	bne :loop
next:
:loop	dey
	bne :loop
`;
		const renamed = `
start:
:again	dex
	bne :again
next:
:loop	dey
	bne :loop
`;
		expect(rename(main, 4, 7, ":again")).toEqual({ "main.asm": renamed });
		expect(rename(main, 3, 1, "again")).toEqual({ "main.asm": renamed });
	});

	it("renames every assignment of a variable, a macro, a function", () => {
		const main = `
count = 1
	.db count
count = count + 1
.macro clear addr
	lda #0
.end
	clear count
.function double(x) = x * 2
	.db double(count)
`;
		expect(rename(main, 3, 6, "total")["main.asm"]).toContain(`
total = 1
	.db total
total = total + 1
`);
		expect(rename(main, 8, 2, "erase")["main.asm"]).toContain(".macro erase addr");
		expect(rename(main, 10, 6, "twice")["main.asm"]).toContain(".function twice(x) = x * 2\n\t.db twice(count)");
	});

	it("renames a label of a macro body, one per call", () => {
		const main = `
.macro wait
:spin	dex
	bne :spin
.end
start:
	wait
	wait
`;
		expect(rename(main, 4, 7, "loop")["main.asm"]).toContain(":loop\tdex\n\tbne :loop\n");
	});

	it("renames, to confirm, the name where the assembly didn't read it, but in comments, strings and fields", () => {
		const main = `
start:	nop
.if 0
	jmp start
.end
.macro never
	jsr start
.end
	.db .def(start)
	.db "start" ; start
.define sprites
  - { start: 1 }
.end
	.db sprites[0].start
`;
		expect(rename(main, 2, 1, "begin")["main.asm"]).toBe(`
begin:	nop
.if 0
	jmp «begin»
.end
.macro never
	jsr «begin»
.end
	.db .def(«begin»)
	.db "start" ; start
.define sprites
  - { start: 1 }
.end
	.db sprites[0].start
`);
	});

	it("looks for a local label the assembly didn't read under its global label only", () => {
		const main = `
start:
:loop	dex
.if 0
	bne :loop
.end
next:
.if 0
	bne :loop
.end
`;
		expect(rename(main, 3, 1, "again")["main.asm"]).toBe(`
start:
:again	dex
.if 0
	bne :«again»
.end
next:
.if 0
	bne :loop
.end
`);
	});

	it("refuses a name that isn't one, an anonymous label, a name built by an expression", () => {
		const main = `
start:	nop
:	bne :-
	.let "pos" + "X" = 10
	lda #posX
`;
		expect(() => rename(main, 2, 1, "1st")).toThrow("`1st` isn't a name: a letter or `_`, then letters, digits or `_`.");
		expect(() => rename(main, 3, 7, "x")).toThrow("An anonymous label has no name to rename.");
		expect(() => rename(main, 5, 7, "x")).toThrow('POSX is written `"pos"` at main.asm:4: a name built by an expression can\'t be renamed.');
	});

	it("refuses the namespace of a qualified name", () => {
		const main = `
.namespace gfx
sprite: rts
.end namespace
	jsr gfx::sprite
`;
		expect(() => rename(main, 5, 6, "x")).toThrow("Only `sprite` here is a symbol's name.");
	});

	it("refuses a name in a macro body that refers to another symbol at another call", () => {
		const main = `
.macro load
	lda #v
.end
.namespace a
v = 1
	load
.end namespace
.namespace b
v = 2
	load
.end namespace
`;
		expect(() => rename(main, 3, 7, "w")).toThrow(
			"This name refers to several symbols, at different macro calls: A::V, B::V. Renaming it would rename them all.",
		);
		expect(() => rename(main, 6, 1, "w")).toThrow(
			"`A::V` at main.asm:3 also refers to B::V, at another macro call: renaming it there would change that one too.",
		);
	});

	it("refuses a new name that clashes or shadows another", () => {
		const main = `
start:	nop
x = 1
.namespace gfx
y = 2
	lda #x
.end namespace
	jmp start
`;
		expect(() => rename(main, 3, 1, "start")).toThrow("Renamed, proj.yaml wouldn't assemble");
		expect(() => rename(main, 3, 1, "y")).toThrow("Renamed, `y` at main.asm:6 would refer to GFX::Y (main.asm:5), not X.");
	});
});
