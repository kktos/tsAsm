import { describe, expect, it } from "vitest";
import { scanBlocks } from "../../format/blocks";
import { analyse } from "../../vscode/analysis";
import { buildOutline, type OutlineNode, workspaceSymbols } from "../../vscode/outline";
import type { SymbolIndex } from "../../vscode/symbol-index";

const PROJECT = `
input:
  source: main.asm
  segments:
    - { name: CODE, start: 0x1000, size: 0x100 }
    - { name: DATA, start: 0x2000, size: 0x100 }
`;

const MAIN = `
.macro clear addr
	lda #0
.end
count = 3
start:
:loop	dex
	bne :loop
.proc init
	nop
inner:	rts
.end
.namespace gfx
sprite: rts
	.function double(x) = x * 2
.end namespace
.segment DATA
done: rts
`;

function indexOf(main: string): SymbolIndex {
	const files: Record<string, string> = { "/p/proj.yaml": PROJECT, "/p/main.asm": main };
	const analysis = analyse("/p/proj.yaml", {
		readText(path) {
			const text = files[path];
			if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
			return text;
		},
		readBytes() {
			return [];
		},
	});
	return analysis.index as SymbolIndex;
}

/** The outline in short, a line per node, indented by its depth: `kind name [detail] range`. */
function outline(main: string, index = indexOf(main)): string[] {
	const lines: string[] = [];
	const add = (nodes: OutlineNode[], depth: number) => {
		for (const { kind, name, detail, range, children } of nodes) {
			lines.push(`${"  ".repeat(depth)}${kind} ${name} [${detail}] ${range.start.line}:${range.start.column}-${range.end.line}:${range.end.column}`);
			add(children, depth + 1);
		}
	};
	add(buildOutline(scanBlocks(main), index.definitions("/p/main.asm")), 0);
	return lines;
}

describe("VS Code outline", () => {
	it("nests the symbols in the blocks around them, a local label under its global one", () => {
		expect(outline(MAIN)).toEqual([
			"macro clear [addr] 2:1-4:5",
			"variable count [$03 (3)] 5:1-5:6",
			"label start [$1000 (4096)] 6:1-7:6",
			"  label :loop [$1000 (4096)] 7:1-7:6",
			"proc init [$1003 (4099)] 9:1-12:5",
			"  label inner [$1004 (4100)] 11:1-11:6",
			"namespace gfx [] 13:1-16:15",
			"  label sprite [$1005 (4101)] 14:1-14:7",
			"  function double [(x)] 15:12-15:18",
			"segment DATA [] 17:1-17:14",
			"label done [$2000 (8192)] 18:1-18:5",
		]);
	});

	it("keeps the blocks while the file doesn't assemble, the symbols from the last good assembly", () => {
		const index = indexOf(MAIN);
		const broken = MAIN.replace("start:", "start:\n\tlda nope");
		index.shift("/p/main.asm", { start: { line: 6, column: 7 }, end: { line: 6, column: 7 }, text: "\n\tlda nope" });
		expect(outline(broken, index).slice(2, 5)).toEqual([
			"label start [$1000 (4096)] 6:1-8:6",
			"  label :loop [$1000 (4096)] 8:1-8:6",
			"proc init [$1003 (4099)] 10:1-13:5",
		]);
	});

	it("gives the blocks of a file in no project, without symbols", () => {
		expect(buildOutline(scanBlocks(MAIN), []).map(({ kind, name }) => `${kind} ${name}`)).toEqual([
			"macro clear",
			"proc init",
			"namespace gfx",
			"segment DATA",
		]);
	});

	it("lists a symbol of a file in two projects once", () => {
		const index = indexOf(MAIN);
		const twice = [...index.definitions("/p/main.asm"), ...indexOf(MAIN).definitions("/p/main.asm")];
		expect(buildOutline(scanBlocks(MAIN), twice)).toHaveLength(7);
	});
});

describe("VS Code workspace symbols", () => {
	const index = indexOf(MAIN);
	const namespaces = [{ name: "gfx", place: { file: "/p/main.asm", line: 13, column: 12, endColumn: 15 } }];
	const symbols = (query: string) =>
		workspaceSymbols(index.definitions(), namespaces, query).map(({ kind, name, container }) => `${kind} ${name}${container ? ` in ${container}` : ""}`);

	it("lists every symbol but the local and anonymous labels, and the namespaces", () => {
		expect(symbols("").sort()).toEqual([
			"function double in GFX",
			"label done",
			"label init",
			"label inner in proc init",
			"label sprite in GFX",
			"label start",
			"macro clear",
			"namespace gfx",
			"variable count",
		]);
	});

	it("keeps the symbols whose name has the query's chars in order, in any case", () => {
		expect(symbols("SRT")).toEqual(["label start", "label sprite in GFX"]);
		expect(symbols("xyz")).toEqual([]);
	});
});
