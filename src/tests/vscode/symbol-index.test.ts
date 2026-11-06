import { describe, expect, it } from "vitest";
import { RelocValue } from "../../assembler/reloc-value.class";
import { analyse } from "../../vscode/analysis";
import { nameSpan } from "../../vscode/places";
import { distinctEntries, findReferences, hoverText, type IndexEntry, shiftPlace, SymbolIndex, valueText } from "../../vscode/symbol-index";

const PROJECT = `
input:
  source: src/main.asm
`;

const MACROS = `
.macro clear addr, ...rest
	lda #0
	sta addr
.end
`;

const MAIN = `
	.include "macros.asm"
count = 3
start:
	clear count
:	nop
:loop	dex
	bne :loop
	bne :-
	.function double(x) = x * 2
	.db double(count)
.namespace gfx
sprite: rts
.namespace global
	jsr gfx::sprite
`;

function analyseFiles(files: Record<string, string>) {
	return analyse("/p/proj.yaml", {
		readText(path) {
			const text = files[path];
			if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
			return text;
		},
		readBytes() {
			return [];
		},
	});
}

const index = analyseFiles({ "/p/proj.yaml": PROJECT, "/p/src/main.asm": MAIN, "/p/src/macros.asm": MACROS }).index as SymbolIndex;

/** The entries at a line and column of main.asm, in short: `REF kind written` and where it's defined, its columns. */
function at(line: number, column: number, file = "/p/src/main.asm") {
	return index.at(file, line, column).map(({ place, definition, symbol, target, written }) => {
		const where = `${target.file.replace("/p/src/", "")}:${target.line}:${target.column}-${target.endColumn}`;
		return `${place.column}-${place.endColumn} ${definition ? "DEF" : "REF"} ${symbol.kind} ${written} -> ${where}`;
	});
}

describe("VS Code symbol index", () => {
	it("finds a name used, and the name of its definition", () => {
		expect(at(5, 9)).toEqual(["8-13 REF variable count -> main.asm:3:1-6"]);
		expect(at(8, 6)).toEqual(["6-11 REF label :loop -> main.asm:7:1-6"]);
		expect(at(9, 7)).toEqual(["6-8 REF anonymous label : -> main.asm:6:1-2"]);
		expect(at(15, 10)).toEqual(["6-17 REF label sprite -> main.asm:13:1-7"]);
	});

	it("finds a macro or a function by its name after the directive, and a function's parameter", () => {
		expect(at(5, 2)).toEqual(["2-7 REF macro clear -> macros.asm:2:8-13"]);
		expect(at(11, 6)).toEqual(["6-12 REF function double -> main.asm:10:12-18"]);
		expect(at(10, 24)).toEqual(["24-25 REF variable x -> main.asm:10:19-20"]);
	});

	it("finds a definition at its name, the cursor on it or right after it", () => {
		expect(at(4, 1)).toEqual(["1-6 DEF label start -> main.asm:4:1-6"]);
		expect(at(4, 6)).toEqual(["1-6 DEF label start -> main.asm:4:1-6"]);
		expect(at(4, 7)).toEqual([]);
		expect(at(2, 10, "/p/src/macros.asm")).toEqual(["8-13 DEF macro clear -> macros.asm:2:8-13"]);
	});

	it("keeps a macro's parameters as written", () => {
		const [entry] = index.at("/p/src/main.asm", 5, 2);
		expect(entry?.symbol.parameters).toEqual(["addr", "...rest"]);
	});

	it("has no index when the assembly stops at an error", () => {
		expect(analyseFiles({ "/p/proj.yaml": PROJECT, "/p/src/main.asm": "\tlda nope\n" }).index).toBeUndefined();
	});

	it("keeps each symbol a name in a macro body refers to, at each call", () => {
		const { index: macroIndex } = analyseFiles({
			"/p/proj.yaml": PROJECT,
			"/p/src/main.asm": `
.macro wait
	jmp :done
:done	rts
.end
start:
	wait
	wait
`,
		});
		expect(macroIndex?.at("/p/src/main.asm", 3, 6).map(({ symbol }) => valueText(symbol.value))).toEqual(["$1003 (4099)", "$1007 (4103)"]);
	});
});

describe("VS Code symbol index after edits", () => {
	const place = { file: "f", line: 5, column: 6, endColumn: 11 };
	const edit = (start: [number, number], end: [number, number], text: string) => ({
		start: { line: start[0], column: start[1] },
		end: { line: end[0], column: end[1] },
		text,
	});

	it("moves a name by the lines added or removed before it", () => {
		expect(shiftPlace(place, edit([2, 1], [2, 1], "\tnop\n"))).toEqual({ ...place, line: 6 });
		expect(shiftPlace(place, edit([2, 1], [4, 1], ""))).toEqual({ ...place, line: 3 });
	});

	it("moves a name by the chars added before it on its line", () => {
		expect(shiftPlace(place, edit([5, 1], [5, 2], "  "))).toEqual({ ...place, column: 7, endColumn: 12 });
		expect(shiftPlace(place, edit([5, 2], [5, 2], "x\ny"))).toEqual({ ...place, line: 6, column: 6, endColumn: 11 });
		expect(shiftPlace(place, edit([3, 4], [5, 3], "a"))).toEqual({ ...place, line: 3, column: 8, endColumn: 13 });
	});

	it("keeps a name before the edit, or right next to it when the edit doesn't join it", () => {
		expect(shiftPlace(place, edit([5, 12], [5, 12], "x"))).toEqual(place);
		expect(shiftPlace(place, edit([6, 1], [9, 1], ""))).toEqual(place);
		expect(shiftPlace(place, edit([5, 11], [5, 11], "\n"))).toEqual(place);
		expect(shiftPlace(place, edit([5, 11], [5, 11], " ; done"))).toEqual(place);
		expect(shiftPlace(place, edit([5, 5], [5, 6], ""))).toEqual({ ...place, column: 5, endColumn: 10 });
	});

	it("drops a name the edit is in, or joins", () => {
		expect(shiftPlace(place, edit([5, 7], [5, 8], ""))).toBeUndefined();
		expect(shiftPlace(place, edit([4, 1], [5, 8], ""))).toBeUndefined();
		expect(shiftPlace(place, edit([5, 11], [5, 11], "s"))).toBeUndefined();
		expect(shiftPlace(place, edit([5, 6], [5, 6], "x"))).toBeUndefined();
	});

	it("moves the targets in the edited file too, and finds the names at their new places", () => {
		const moved = analyseFiles({ "/p/proj.yaml": PROJECT, "/p/src/main.asm": MAIN, "/p/src/macros.asm": MACROS }).index as SymbolIndex;
		moved.shift("/p/src/main.asm", edit([1, 1], [1, 1], "; a comment\n"));
		const [count] = moved.at("/p/src/main.asm", 6, 9);
		expect(count?.target).toEqual({ file: "/p/src/main.asm", line: 4, column: 1, endColumn: 6 });
		const [clear] = moved.at("/p/src/main.asm", 6, 2);
		expect(clear?.target).toEqual({ file: "/p/src/macros.asm", line: 2, column: 8, endColumn: 13 });
	});
});

describe("VS Code hover", () => {
	const entries = (line: number, column: number) => distinctEntries(index.at("/p/src/main.asm", line, column));
	const relative = (file: string) => file.replace("/p/", "");

	it("tells a label's value, in hex and decimal, and where it's defined", () => {
		expect(hoverText(entries(15, 10), relative)).toBe("```tsasm\nlabel GFX::sprite = $100B (4107)\n```\nDefined in `src/main.asm:13`.");
	});

	it("tells a variable's value here, and its last one at its definition", () => {
		expect(hoverText(entries(5, 9), relative)).toBe("```tsasm\nvariable count = $03 (3) ; its value here\n```\nDefined in `src/main.asm:3`.");
		expect(hoverText(entries(3, 1), relative)).toBe("```tsasm\nvariable count = $03 (3) ; its last value\n```");
	});

	it("tells a macro's and a function's parameters, and the scope of a function's parameter", () => {
		expect(hoverText(entries(5, 2), relative)).toBe("```tsasm\n.macro clear addr, ...rest\n```\nDefined in `src/macros.asm:2`.");
		expect(hoverText(entries(11, 6), relative)).toBe("```tsasm\n.function double(x)\n```\nDefined in `src/main.asm:10`.");
		expect(hoverText(entries(10, 24), relative)).toBe(
			"```tsasm\nvariable x = $03 (3) ; its value here\n```\nIn function double.\nDefined in `src/main.asm:10`.",
		);
	});

	it("tells five symbols at most", () => {
		const [entry] = entries(5, 9) as [IndexEntry];
		const many = [1, 2, 3, 4, 5, 6, 7].map((value) => ({ ...entry, symbol: { ...entry.symbol, value } }));
		const text = hoverText(many, relative);
		expect(text.split("---")).toHaveLength(6);
		expect(text.endsWith("And 2 more.")).toBe(true);
	});

	it("writes a value as the symbol file does", () => {
		expect(valueText(0x10000)).toBe("$010000 (65536)");
		expect(valueText(-1)).toBe("-1");
		expect(valueText(1.5)).toBe("1.5");
		expect(valueText("hi")).toBe('"hi"');
		expect(valueText([1, 2])).toBe("[1,2]");
		expect(valueText(new RelocValue("CODE", 0x12))).toBe("CODE+$0012");
		expect(valueText(undefined)).toBeUndefined();
	});
});

describe("VS Code name spans", () => {
	it("finds a definition's name: its token, a local label's after its prefix, or after a directive", () => {
		expect(nameSpan("start: nop", 1, "START")).toEqual([1, 6]);
		expect(nameSpan("!loop dex", 1, "START.LOOP")).toEqual([1, 6]);
		expect(nameSpan(".macro clear addr", 1, "CLEAR")).toEqual([8, 13]);
		expect(nameSpan("\t.function double(x) = x * 2", 2, "X")).toEqual([19, 20]);
		expect(nameSpan(":\tnop", 1, ":")).toEqual([1, 2]);
	});
});

describe("VS Code references", () => {
	/** The references to the name at a line and column of main.asm, as `file:line:column`. */
	const references = (line: number, column: number, includeDeclaration: boolean, indexes = [index]) =>
		findReferences(indexes, distinctEntries(indexes.flatMap((each) => each.at("/p/src/main.asm", line, column))), includeDeclaration).map(
			({ file, line: at, column: col }) => `${file.replace("/p/src/", "")}:${at}:${col}`,
		);

	it("lists the references to a symbol, and its definition when asked", () => {
		expect(references(5, 9, false)).toEqual(["main.asm:5:8", "main.asm:11:13"]);
		expect(references(5, 9, true)).toEqual(["main.asm:3:1", "main.asm:5:8", "main.asm:11:13"]);
	});

	it("lists them from the definition too", () => {
		expect(references(3, 2, false)).toEqual(["main.asm:5:8", "main.asm:11:13"]);
	});

	it("lists a macro's calls, its definition in its file", () => {
		expect(references(5, 2, true)).toEqual(["macros.asm:2:8", "main.asm:5:2"]);
	});

	it("tells a local label's references, and an anonymous label's, from the others", () => {
		expect(references(8, 7, true)).toEqual(["main.asm:7:1", "main.asm:8:6"]);
		expect(references(9, 6, true)).toEqual(["main.asm:6:1", "main.asm:9:6"]);
	});

	it("lists nothing where there's no name", () => {
		expect(references(6, 3, true)).toEqual([]);
	});

	it("lists a name in a macro body once, though each call has its symbol", () => {
		const { index: macroIndex } = analyseFiles({
			"/p/proj.yaml": PROJECT,
			"/p/src/main.asm": `
.macro wait
	jmp :done
:done	rts
.end
start:
	wait
	wait
`,
		});
		expect(references(3, 6, true, [macroIndex as SymbolIndex])).toEqual(["main.asm:3:6", "main.asm:4:1"]);
	});

	it("lists a variable's assignments, its last one its definition", () => {
		const { index: variables } = analyseFiles({
			"/p/proj.yaml": PROJECT,
			"/p/src/main.asm": `
count = 1
	.db count
count = count + 1
`,
		});
		expect(references(2, 1, false, [variables as SymbolIndex])).toEqual(["main.asm:2:1", "main.asm:3:6", "main.asm:4:9"]);
		expect(references(2, 1, true, [variables as SymbolIndex])).toEqual(["main.asm:2:1", "main.asm:3:6", "main.asm:4:1", "main.asm:4:9"]);
	});

	it("lists a reference once when its file is in two projects", () => {
		const other = analyseFiles({ "/p/proj.yaml": PROJECT, "/p/src/main.asm": MAIN, "/p/src/macros.asm": MACROS }).index as SymbolIndex;
		expect(references(5, 9, false, [index, other])).toEqual(["main.asm:5:8", "main.asm:11:13"]);
	});

	it("lists them at their places after an edit", () => {
		const moved = analyseFiles({ "/p/proj.yaml": PROJECT, "/p/src/main.asm": MAIN, "/p/src/macros.asm": MACROS }).index as SymbolIndex;
		moved.shift("/p/src/main.asm", { start: { line: 4, column: 1 }, end: { line: 4, column: 1 }, text: "\tnop\n" });
		expect(references(6, 9, true, [moved])).toEqual(["main.asm:3:1", "main.asm:6:8", "main.asm:12:13"]);
	});
});
