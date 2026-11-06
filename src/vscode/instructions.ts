/**
 * instructions.ts
 *
 * * The hover on a mnemonic: the ways to write it on the current CPU (the last `.cpu` above, else the project's), each
 *   with its addressing mode, its opcode and its size; on every CPU having it for a file in no project.
 * * The form the line assembled to is marked, from its bytes (the inlay hints'), and its bytes are shown.
 * * Without the vscode module, so it can be tested.
 */

import { getHex } from "../utils/hex.util";
import { currentCpu, lineBefore, type SourceContext, statementWords } from "./completion";

/** What the hover shows, and the columns of the mnemonic, from 1, `end` after its last char. */
export interface InstructionHover {
	text: string;
	start: number;
	end: number;
}

/** The bytes the cursor's line assembled to, in its first run, and how many runs. */
export interface LineBytes {
	bytes: number[];
	runs: number;
}

const WORD = /[A-Za-z_]\w*/g;

/** The hover on the mnemonic at the cursor, `line` its line's bytes: undefined when the cursor isn't on one. */
export function instructionHover(context: SourceContext, line?: LineBytes): InstructionHover | undefined {
	const lineText = context.text.split("\n")[context.line - 1]?.replace(/\r$/, "") ?? "";
	const cursor = context.column - 1;
	const word = [...lineText.matchAll(WORD)].find(({ index, 0: text }) => index <= cursor && cursor <= index + text.length);
	if (!word) return undefined;
	const written = word[0];
	const start = word.index + 1;
	const end = start + written.length;
	// A directive, a qualified or a local name, a label.
	if (/[.:@!?~]$/.test(lineText.slice(0, word.index)) || /^\s*:/.test(lineText.slice(end - 1))) return undefined;

	const { inComment, inString, statement } = lineBefore({ ...context, column: end });
	if (inComment || inString) return undefined;
	const name = written.toUpperCase();
	const cpu = currentCpu(context);
	const cpus = (cpu ? [cpu] : context.language.cpus).filter(({ mnemonics }) => mnemonics.includes(name));
	if (cpus.length === 0) return undefined;
	const { atHead } = statementWords(statement, written, (head) => cpus.some(({ mnemonics }) => mnemonics.includes(head.toUpperCase())));
	if (!atHead) return undefined;

	const lower = written !== name;
	// The line's bytes tell its form on its CPU only.
	const assembled = cpus.length === 1 && line && line.bytes.length > 0 ? line : undefined;
	const sections = cpus.map(({ name: cpuName, describe }) => {
		const forms = describe(name);
		const title = `**${written}** — ${cpuName}`;
		if (forms.length === 0) return title;
		// The form the line assembled to: its opcode starts the bytes, or it's the only one.
		const matched =
			assembled &&
			(forms.length === 1 ? forms[0] : forms.find(({ opcode }) => opcode.length > 0 && opcode.every((byte, at) => assembled.bytes[at] === byte)));
		const rows = forms.map((form) => {
			const operands = lower ? form.operands.toLowerCase() : form.operands;
			const syntax = `\`${operands ? `${written} ${operands}` : written}\``;
			const opcode = form.fields ?? `\`${hex(form.opcode)}\``;
			const [least, most] = form.size;
			const size = least === most ? String(least) : `${least}–${most}`;
			return `| ${form === matched ? "▶ " : ""}${syntax} | ${form.mode} | ${opcode} | ${size} |`;
		});
		return [title, "", "| Operands | Mode | Opcode | Bytes |", "|:--|:--|:--|--:|", ...rows].join("\n");
	});
	if (assembled) sections.push(`${assembled.runs > 1 ? `First of ${assembled.runs} runs` : "This line"}: \`${hex(assembled.bytes)}\``);
	return { text: sections.join("\n\n"), start, end };
}

const hex = (bytes: number[]) => bytes.map((byte) => getHex(byte, 2)).join(" ");
