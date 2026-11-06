import { describe, expect, it } from "vitest";
import { analyse } from "../../vscode/analysis";
import { type Completion, complete, type SourceContext, signatureAt } from "../../vscode/completion";
import { language } from "../../vscode/language";

const LANGUAGE = language();

const project = (cpu = "6502") => `
input:
  source: main.asm
  cpu: ${cpu}
  segments:
    - { name: CODE, start: 0x1000, size: 0x100 }
`;

const MAIN = `
.macro clear addr, ...rest
	lda #0
.end
count = 3
	.function double(x) = x * 2
start:
:loop	dex
	bne :loop
.proc init
inner:	rts
.end
.namespace gfx
sprite:	rts
.end namespace
next:
:wait	nop
`;

/**
 * The context of the cursor, `|` in `edited`: the definitions from `main` assembled, as the last good assembly's;
 * `edited` is `main` with a line added at its end by default.
 */
function context(edited: string, main = MAIN, cpu = "6502"): SourceContext {
	const texts: Record<string, string> = { "/p/proj.yaml": project(cpu), "/p/main.asm": main };
	const analysis = analyse("/p/proj.yaml", {
		readText(path) {
			const text = texts[path];
			if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
			return text;
		},
		readBytes: () => [],
	});
	const text = edited.includes("\n") ? edited : `${main}${edited}`;
	const offset = text.indexOf("|");
	const lines = text.slice(0, offset).split("\n");
	return {
		text: text.replace("|", ""),
		line: lines.length,
		column: (lines.at(-1) as string).length + 1,
		language: LANGUAGE,
		cpu: analysis.cpu as string,
		definitions: analysis.index?.definitions() ?? [],
		namespaces: ["gfx"],
		file: "/p/main.asm",
	};
}

const labels = (items: Completion[], kind?: string) => items.filter((item) => !kind || item.kind === kind).map(({ label }) => label);

describe("VS Code completion", () => {
	it("gives the current CPU's mnemonics at a statement's start, after a label too, in the case typed", () => {
		const items = complete(context("\tLD|"));
		expect(labels(items, "mnemonic")).toContain("LDA");
		expect(labels(items, "mnemonic")).not.toContain("LDB");
		expect(labels(complete(context("here: ld|")), "mnemonic")).toContain("lda");
		expect(labels(complete(context("\t.cpu 6809\n\tld|")), "mnemonic")).toContain("ldb");
		expect(labels(complete(context("\tld|", MAIN, "6809")), "mnemonic")).toContain("ldb");
	});

	it("writes them as most of the file's mnemonics when nothing is typed yet", () => {
		expect(labels(complete(context("\t|")), "mnemonic")).toContain("lda");
		expect(labels(complete(context("\tLDA #0\n\tRTS\n\tNOP\n\t|")), "mnemonic")).toContain("LDA");
	});

	it("gives the macros at a statement's start, with their parameters", () => {
		expect(complete(context("\tcl|")).find(({ kind }) => kind === "macro")).toMatchObject({ label: "clear", detail: "addr, ...rest" });
	});

	it("gives the directives after a dot, a CPU's own only for it", () => {
		const items = labels(complete(context("\t.ma|")), "directive");
		expect(items).toContain(".macro");
		expect(items).toContain(".else");
		expect(items).not.toContain(".=");
		const own = LANGUAGE.cpus.find(({ directives }) => directives.length > 0);
		if (own) {
			const name = `.${(own.directives[0] as string).toLowerCase()}`;
			expect(labels(complete(context(`\t.cpu ${own.name}\n\t.|`)), "directive")).toContain(name);
			expect(labels(complete(context("\t.|")), "directive")).not.toContain(name);
		}
	});

	it("gives the symbols in scope in an operand, another namespace's qualified, and the namespaces", () => {
		const items = complete(context("\tlda |"));
		expect(labels(items).filter((label) => !label.startsWith("."))).toEqual(
			expect.arrayContaining(["count", "double", "start", "init", "gfx::sprite", "next", "gfx::"]),
		);
		expect(labels(items)).not.toContain("inner");
		expect(items.find(({ label }) => label === "count")).toMatchObject({ kind: "variable", detail: "variable = $03 (3)" });
		expect(items.find(({ label }) => label === "double")).toMatchObject({ insert: "double($1)", snippet: true, parameterHints: true });
	});

	it("gives a proc's symbols in it, a namespace's bare in it, and after its name and ::", () => {
		const inProc = MAIN.replace("inner:\trts", "inner:\trts\n\tjmp |");
		expect(labels(complete(context(inProc)))).toContain("inner");
		const inNamespace = MAIN.replace("sprite:\trts", "sprite:\trts\n\tjmp |");
		expect(labels(complete(context(inNamespace)))).toContain("sprite");
		const qualified = complete(context("\tjsr gfx::sp|"));
		expect(qualified.map(({ label, start, end }) => `${label} ${start}-${end}`)).toEqual(["sprite 11-13"]);
	});

	it("gives the local labels under the global label before the cursor", () => {
		expect(labels(complete(context("\tbne :|")))).toEqual([":wait"]);
		const inStart = MAIN.replace("\tbne :loop", "\tbne :|");
		expect(labels(complete(context(inStart)))).toEqual([":loop"]);
	});

	it("gives the system functions and variables after a dot in an operand", () => {
		const items = complete(context("\tlda #.p|"));
		expect(items.find(({ label }) => label === ".pad")).toMatchObject({
			kind: "system function",
			insert: ".pad($1)",
			detail: ".pad(value, width, fill?)",
			documentation: expect.stringContaining("padded"),
		});
		expect(items.find(({ label }) => label === ".pc")).toMatchObject({ kind: "system variable", insert: ".pc" });
	});

	it("gives .option's names and .cpu's CPUs", () => {
		const options = complete(context("\t.option local.p|"));
		expect(options.find(({ label }) => label === "local.prefix")).toMatchObject({ kind: "option", start: 10, end: 17 });
		expect(labels(complete(context("\t.cpu |")))).toEqual(LANGUAGE.cpus.map(({ name }) => name));
	});

	it("gives nothing in a comment or a string", () => {
		expect(complete(context("\tlda #0 ; ld|"))).toEqual([]);
		expect(complete(context('\t.db "ld|'))).toEqual([]);
	});
});

describe("VS Code signature help", () => {
	const help = (edited: string) => {
		const signature = signatureAt(context(edited));
		if (!signature) return undefined;
		const [start, end] = signature.parameters[signature.active] ?? [0, 0];
		return `${signature.label} @ ${signature.label.slice(start, end)}`;
	};

	it("tells a system function's parameters, and the one at the cursor", () => {
		expect(help("\tlda #.pad(1, |")).toBe(".pad(value, width, fill?) @ width");
		expect(help("\t.db .push(list, 1, 2, |")).toBe(".push(array, item…) @ item…");
		expect(help('\t.db .pad(.len("ab"), |')).toBe(".pad(value, width, fill?) @ width");
		expect(signatureAt(context("\tlda #.pad(1, |"))?.documentation).toContain("padded");
	});

	it("tells a function's and a macro's parameters, a rest one taking the others", () => {
		expect(help("\t.db double(|")).toBe("double(x) @ x");
		expect(help("\tclear $10|")).toBe("clear addr, ...rest @ addr");
		expect(help("\tclear $10, 1, (2, 3), |")).toBe("clear addr, ...rest @ ...rest");
		expect(help("here:\tclear(1, |")).toBe("clear(addr, ...rest) @ ...rest");
	});

	it("tells nothing out of a call", () => {
		expect(help("\tlda #1|")).toBeUndefined();
		expect(help("\tclear|")).toBeUndefined();
	});
});
