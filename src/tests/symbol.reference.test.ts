import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { FileHandler, SymbolReference } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";

/** The references `onSymbolReference` gets assembling `source` (`main.asm`), the other files in `files`. */
function references(source: string, files: Record<string, string> = {}) {
	const all: SymbolReference[] = [];
	const fileHandler: FileHandler = {
		fullpath: "main.asm",
		filename: "main.asm",
		readSourceFile(filename, from) {
			this.fullpath = from ? posix.join(posix.dirname(from), filename) : filename;
			this.filename = posix.basename(filename);
			const text = files[this.fullpath];
			if (text === undefined) throw new Error(`no file ${this.fullpath}`);
			return text;
		},
		readBinaryFile() {
			return [];
		},
	};
	const assembler = new Assembler(new Cpu6502Handler(), fileHandler, { onSymbolReference: (reference) => all.push(reference) });
	let error: unknown;
	try {
		assembler.assemble(source);
	} catch (e) {
		error = e;
	}
	return { all, error };
}

/** A reference in short: `file:line:column` where it's written, and what it names, `kind name = value @ file:line:column`. */
function short({ at, symbol }: SymbolReference): string {
	const where = (location: SymbolReference["at"]) => `${location.file}:${location.line}:${location.column}`;
	const name = symbol.namespace ? `${symbol.namespace}::${symbol.name}` : symbol.name;
	const value = symbol.parameters ? `(${symbol.parameters.join(", ")})` : symbol.value === undefined ? "" : ` = ${String(symbol.value)}`;
	return `${where(at)} ${symbol.kind} ${name}${value} @ ${where(symbol.site.location)}`;
}

const used = (source: string, files?: Record<string, string>) =>
	references(source, files)
		.all.filter((ref) => !ref.definition)
		.map(short);
const defined = (source: string, files?: Record<string, string>) =>
	references(source, files)
		.all.filter((ref) => ref.definition)
		.map(short);

describe("onSymbolReference", () => {
	it("tells each name pass 2 resolves, where it's written and what it names", () => {
		expect(
			used(`
count = 3
max .equ 10
start:
	lda #count
	ldx #max
:loop	dex
	bne :loop
	jmp start
`),
		).toEqual([
			"main.asm:5:7 variable COUNT = 3 @ main.asm:2:1",
			"main.asm:6:7 constant MAX = 10 @ main.asm:3:1",
			"main.asm:8:6 label START.LOOP = 4100 @ main.asm:7:1",
			"main.asm:9:6 label START = 4096 @ main.asm:4:1",
		]);
	});

	it("tells a forward reference once, from pass 2", () => {
		expect(
			used(`
	jmp later
later:
	rts
`),
		).toEqual(["main.asm:2:6 label LATER = 4099 @ main.asm:3:1"]);
	});

	it("tells a name in a namespace, written with it", () => {
		expect(
			used(`
.namespace gfx
sprite: rts
.namespace global
	jsr gfx::sprite
`),
		).toEqual(["main.asm:5:6 label GFX::SPRITE = 4096 @ main.asm:3:1"]);
	});

	it("tells an anonymous label reference, the label it reaches", () => {
		expect(
			used(`
:	dex
	bne :-
	beq :+
	nop
:	rts
`),
		).toEqual(["main.asm:3:6 anonymous label : = 4096 @ main.asm:2:1", "main.asm:4:6 anonymous label : = 4102 @ main.asm:6:1"]);
	});

	it("tells a macro call, a macro argument at the call, a name in the body at its line in the macro's file", () => {
		expect(
			used(
				`
	.include "macros.asm"
count = 3
start:
	clear count
	clear count
`,
				{
					"macros.asm": `
.macro clear addr, ...rest
	lda #0
	sta addr
	jmp :done
:done	rts
.end
`,
				},
			),
		).toEqual([
			"main.asm:5:2 macro CLEAR(ADDR, ...REST) @ macros.asm:2:1",
			"main.asm:5:8 variable COUNT = 3 @ main.asm:3:1",
			"macros.asm:5:6 label macro clear::START.DONE = 4103 @ macros.asm:6:1",
			"main.asm:6:2 macro CLEAR(ADDR, ...REST) @ macros.asm:2:1",
			"main.asm:6:8 variable COUNT = 3 @ main.asm:3:1",
			"macros.asm:5:6 label macro clear::START.DONE = 4111 @ macros.asm:6:1",
		]);
	});

	it("tells a function call, and a parameter in its body", () => {
		expect(
			used(`
count = 3
	.function double(x) = x * 2
	.db double(count)
`),
		).toEqual([
			"main.asm:4:13 variable COUNT = 3 @ main.asm:2:1",
			"main.asm:4:6 function DOUBLE(x) @ main.asm:3:3",
			"main.asm:3:24 variable function double::X = 3 @ main.asm:3:2",
		]);
	});

	it("tells each assignment of a variable, with = or .let, but a name built by an expression", () => {
		expect(
			used(`
count = 1
count = count + 1
	.let count = 3
	.let "co" + "unt" = 4
`),
		).toEqual([
			"main.asm:2:1 variable COUNT = 1 @ main.asm:5:7",
			"main.asm:3:9 variable COUNT = 1 @ main.asm:5:7",
			"main.asm:3:1 variable COUNT = 2 @ main.asm:5:7",
			"main.asm:4:7 variable COUNT = 3 @ main.asm:5:7",
		]);
	});

	it("tells, once assembled, every symbol, macro and anonymous label defined", () => {
		expect(
			defined(
				`
	.include "lib/sub.asm"
.macro m
.end
:	rts
`,
				{ "lib/sub.asm": "count = 3\nstart: nop\n" },
			),
		).toEqual([
			"lib/sub.asm:1:1 variable COUNT = 3 @ lib/sub.asm:1:1",
			"lib/sub.asm:2:1 label START = 4096 @ lib/sub.asm:2:1",
			"main.asm:3:1 macro M() @ main.asm:3:1",
			"main.asm:5:1 anonymous label : = 4097 @ main.asm:5:1",
		]);
	});

	it("tells the references before an error, and no definition", () => {
		const { all, error } = references(`
start:
	jmp start
	lda nope
`);
		expect(error).toBeDefined();
		expect(all.map(short)).toEqual(["main.asm:3:6 label START = 4096 @ main.asm:2:1"]);
	});
});
