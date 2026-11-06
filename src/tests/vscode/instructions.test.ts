import { describe, expect, it } from "vitest";
import { analyse } from "../../vscode/analysis";
import type { SourceContext } from "../../vscode/completion";
import { instructionHover, type LineBytes } from "../../vscode/instructions";
import { language } from "../../vscode/language";
import type { SymbolIndex } from "../../vscode/symbol-index";

const LANGUAGE = language();

const project = (cpu: string) => `
input:
  source: main.asm
  cpu: ${cpu}
  segments:
    - { name: CODE, start: 0x1000, size: 0x100 }
`;

/**
 * The hover at `|` in `main`, assembled as a project's main file on `cpu` (null: a file in no project), with its line's
 * bytes from the assembly.
 */
function hover(main: string, cpu: string | null = "6502") {
	const text = main.replace("|", "");
	const before = main.slice(0, main.indexOf("|")).split("\n");
	const line = before.length;
	let bytes: LineBytes | undefined;
	let definitions: SourceContext["definitions"] = [];
	if (cpu) {
		const texts: Record<string, string> = { "/p/proj.yaml": project(cpu), "/p/main.asm": text };
		const analysis = analyse("/p/proj.yaml", { readText: (path) => texts[path] as string, readBytes: () => [] });
		expect(analysis.diagnostics).toEqual([]);
		const index = analysis.index as SymbolIndex;
		definitions = index.definitions();
		const hint = index.hintsIn("/p/main.asm").find(({ place }) => place.line === line);
		if (hint?.bytes) bytes = { bytes: hint.bytes, runs: hint.runs };
	}
	const context: SourceContext = {
		text,
		line,
		column: (before.at(-1) as string).length + 1,
		language: LANGUAGE,
		...(cpu ? { cpu } : {}),
		definitions,
		namespaces: [],
		file: "/p/main.asm",
	};
	return instructionHover(context, bytes);
}

/** A hover's table rows, in short: `operands | mode | opcode | bytes`, `▶` on the line's form. */
const rows = (text: string) =>
	text
		.split("\n")
		.filter((row) => row.startsWith("| ") && !row.startsWith("| Operands"))
		.map((row) => row.slice(2, -2).replaceAll("`", ""));

describe("VS Code mnemonic hover", () => {
	it("lists the mnemonic's forms on the project's CPU, in the case written, the line's marked, its bytes", () => {
		const result = hover("\tld|a #1");
		expect(result).toMatchObject({ start: 2, end: 5 });
		const text = result?.text as string;
		expect(text).toContain("**lda** — 6502");
		expect(rows(text)).toContain("▶ lda #$12 | IMMEDIATE | A9 | 2");
		expect(rows(text)).toContain("lda $12,x | ZEROPAGE_X | B5 | 2");
		expect(rows(text)).toContain("lda $1234,y | ABSOLUTE_Y | B9 | 3");
		expect(rows(text)).not.toContain("lda ($12) | ZEROPAGE_INDIRECT | B2 | 2");
		expect(text).toContain("This line: `A9 01`");
		expect(rows(hover("\tLDA| $1234")?.text as string)).toContain("▶ LDA $1234 | ABSOLUTE | AD | 3");
	});

	it("follows a .cpu above the line", () => {
		expect(rows(hover("\t.cpu 65c02\n\tld|a ($10)")?.text as string)).toContain("▶ lda ($12) | ZEROPAGE_INDIRECT | B2 | 2");
	});

	it("gives the 65816's immediate sizes, the 6809's pages and indexed sizes, the RV32I's fields", () => {
		expect(rows(hover("\t|lda #1", "65816")?.text as string)).toContain("▶ lda #$12 | IMMEDIATE | A9 | 2–3");
		const ldy = rows(hover("\tld|y #$1234", "6809")?.text as string);
		expect(ldy).toContain("▶ ldy #$1234 | IMMEDIATE | 10 8E | 4");
		expect(ldy).toContain("ldy $10,x | INDEXED | 10 AE | 3–5");
		expect(rows(hover("\tps|hs a,b", "6809")?.text as string)).toEqual(["▶ pshs a, b, x | INHERENT | 34 | 2"]);
		expect(rows(hover("\tsu|b x1, x2, x3", "RV32I")?.text as string)).toEqual(["▶ sub rd, rs1, rs2 | R-type | opcode $33, funct3 0, funct7 $20 | 4"]);
		expect(rows(hover("\tl|w x1, 4(x2)", "RV32I")?.text as string)).toEqual(["▶ lw rd, imm(rs1) | I-type | opcode 3, funct3 2 | 4"]);
	});

	it("gives a repeated line's first run, after a label too", () => {
		const text = hover(".repeat 2\n:\tld|a #1\n.end")?.text as string;
		expect(rows(text)).toContain("▶ lda #$12 | IMMEDIATE | A9 | 2");
		expect(text).toContain("First of 2 runs: `A9 01`");
	});

	it("gives every CPU having it for a file in no project, without marking", () => {
		const text = hover("\tl|da #1", null) as { text: string };
		expect(text.text).toContain("**lda** — 6502");
		expect(text.text).toContain("**lda** — 65C02");
		expect(text.text).toContain("**lda** — 6809");
		expect(text.text).not.toContain("RV32I");
		expect(text.text).not.toContain("▶");
		expect(text.text).not.toContain("This line");
	});

	it("gives nothing off a mnemonic: an operand, a label, a directive, a comment, a string", () => {
		expect(hover("\tjmp ns|\nns:")).toBeUndefined();
		expect(hover("\tjmp| nop\nnop:")).toMatchObject({ start: 2 });
		expect(hover("\tjmp nop|\nnop:")).toBeUndefined();
		expect(hover("ns|:\tnop\n\tjmp ns")).toBeUndefined();
		expect(hover("\t.d|b 1")).toBeUndefined();
		expect(hover("\tnop ; ld|a")).toBeUndefined();
		expect(hover('\t.db "ld|a"')).toBeUndefined();
	});
});
