/**
 * format.ts
 *
 * * A source laid out in columns: its labels at the line's start, its mnemonics, directives and macro calls in the
 *   opcode column, their operands in the operand column, the end-of-line comments in the comment column. With tabs or
 *   spaces, as the editor's settings (`.editorconfig`) say.
 * * Only the whitespace between these fields changes: an operand is kept as written, and so are a comment alone on its
 *   line, a block comment's lines and a raw block's text (`.define`, `.hex`, a `.segment`'s definition).
 * * A block's body (`.macro`, `.proc`, `.function`, `.if`, `.repeat`, `.for`) is indented one level, its labels staying at
 *   the line's start; a namespace's isn't, as it may run to the end of the file.
 * * Checked: the result must have the same tokens as the source, else the source is given back as it is.
 * * Without the vscode module: shared by the VS Code extension and the CLI, so the two lay a source out the same way.
 */

import { AssemblyLexer, type Token } from "../../shared/lexer/lexer.class";
import { type Block, scanBlocks } from "./blocks";
import { blankComments } from "./comments";

export interface FormatOptions {
	/** The width of a tab, and of an indentation level. */
	tabSize: number;
	/** Spaces, else tabs. */
	insertSpaces: boolean;
	/** The columns, from 0, of the mnemonics, the operands, the comments: rounded up to a tab stop with tabs. */
	opcodeColumn: number;
	operandColumn: number;
	commentColumn: number;
	/** Whether a block's body is indented. */
	indentBlocks: boolean;
}

export const DEFAULT_FORMAT: Omit<FormatOptions, "tabSize" | "insertSpaces"> = {
	opcodeColumn: 8,
	operandColumn: 16,
	commentColumn: 40,
	indentBlocks: true,
};

/**
 * Whether `word` (in upper case, its mnemonic suffix removed: `LDA` for `lda.w`) starts a statement on `line` (from 1): a
 * mnemonic of the CPU there, or a macro. A word it doesn't know keeps the side it's written on: at the line's start a
 * label, else a statement.
 */
export type IsStatement = (word: string, line: number) => boolean;

/** What `statementTest` needs of a CPU: its names, what `.cpu` takes, and its mnemonics, in upper case. */
export interface StatementCpu {
	names: readonly string[];
	mnemonics: readonly string[];
}

/** A line's fields: `label`, `opcode` and `operand` as written, `comment` from its `;`, `//` or `/*` to the line's end. */
interface Fields {
	label?: string;
	opcode?: string;
	/** What follows the opcode, as written: after `}`, with the whitespace before it. */
	operand?: string;
	comment?: string;
	/** Whether a `/*` on the line isn't closed on it. */
	opensComment: boolean;
}

const BODY_KINDS = new Set<Block["kind"]>(["macro", "proc", "function", "if", "loop"]);
const RAW_KINDS = new Set<Block["kind"]>(["define", "hex", "segment"]);

/** `source` laid out in columns. */
export function formatSource(source: string, options: FormatOptions, isStatement: IsStatement): string {
	const lines = source.split("\n");
	const blocks = scanBlocks(source);
	const depths = lineDepths(lines.length, blocks);
	const raw = rawLines(blocks, lines);

	let inComment = false;
	const formatted = lines.map((text, index) => {
		const line = index + 1;
		const cr = text.endsWith("\r") ? "\r" : "";
		const body = cr ? text.slice(0, -1) : text;
		if (inComment) {
			if (body.includes("*/")) inComment = false;
			return text;
		}
		if (raw.has(line)) return text;
		const fields = splitFields(body, (word) => isStatement(word.replace(/\..*$/, "").toUpperCase(), line));
		if (!fields) return text;
		if (fields.opensComment) inComment = true;
		if (fields.label === undefined && fields.opcode === undefined) return text;
		const depth = options.indentBlocks ? (depths[index] ?? 0) : 0;
		return layout(fields, depth, options) + cr;
	});
	const result = formatted.join("\n");
	return sameTokens(source, result) ? result : source;
}

/** Each line's depth, from 0: how many blocks' bodies it's in, a branch's `.else` at its `.if`'s depth. */
function lineDepths(count: number, blocks: Block[]): number[] {
	const depths = Array.from({ length: count }, () => 0);
	for (const block of blocks) {
		if (!BODY_KINDS.has(block.kind)) continue;
		const last = block.closed ? block.end.line - 1 : block.end.line;
		for (let line = block.start.line + 1; line <= last; line++) depths[line - 1] = (depths[line - 1] ?? 0) + 1;
		for (const branch of block.branches ?? []) depths[branch.line - 1] = (depths[branch.line - 1] ?? 1) - 1;
	}
	return depths;
}

/** The lines of raw text, kept as they are: a raw block's but its first, and its last unless it starts with `.end` or `}`. */
function rawLines(blocks: Block[], lines: string[]): Set<number> {
	const raw = new Set<number>();
	for (const block of blocks) {
		if (!RAW_KINDS.has(block.kind) || block.end.line === block.start.line) continue;
		for (let line = block.start.line + 1; line < block.end.line; line++) raw.add(line);
		const last = lines[block.end.line - 1]?.trim() ?? "";
		const closer = /^\.end\b/i.test(last) || last.startsWith("}");
		if (!block.closed || !closer) raw.add(block.end.line);
	}
	return raw;
}

/**
 * A line's fields, split on the whitespace outside strings and comments: none for a blank line or a comment alone;
 * undefined for a line to keep as it is: a block comment closed on it with code after it, a line starting with `#`.
 */
function splitFields(text: string, isHead: (word: string) => boolean): Fields | undefined {
	const words: string[] = [];
	/** Where each word starts. */
	const starts: number[] = [];
	let comment: string | undefined;
	let commentStart = text.length;
	let opensComment = false;
	let i = 0;
	while (i < text.length) {
		const char = text[i] as string;
		if (char === " " || char === "\t") {
			i++;
			continue;
		}
		if (char === ";" || text.startsWith("//", i) || text.startsWith("/*", i)) {
			if (text.startsWith("/*", i)) {
				const end = text.indexOf("*/", i + 2);
				if (end < 0) opensComment = true;
				else if (text.slice(end + 2).trim() !== "") return undefined;
			}
			comment = text.slice(i).trimEnd();
			commentStart = i;
			break;
		}
		const start = i;
		while (i < text.length && text[i] !== " " && text[i] !== "\t") {
			const c = text[i] as string;
			if (c === ";" || text.startsWith("//", i) || text.startsWith("/*", i)) break;
			if (c === '"' || c === "'") {
				i++;
				while (i < text.length && text[i] !== c) i += text[i] === "\\" ? 2 : 1;
			}
			i++;
		}
		words.push(text.slice(start, i));
		starts.push(start);
	}
	if (words.length === 0) return { comment, opensComment };
	// No statement starts with `#`: a linker script's comment, its spaces kept.
	if (words[0]?.startsWith("#")) return undefined;
	const code = text.slice(0, commentStart).trimEnd();
	return { ...fieldsOf(words, starts, code, isHead), comment, opensComment };
}

/** Which words of `code`, the line without its comment, are the label, the opcode and the operand. */
function fieldsOf(words: string[], starts: number[], code: string, isHead: (word: string) => boolean): Pick<Fields, "label" | "opcode" | "operand"> {
	const [first, second] = words as [string, string | undefined];
	const after = (index: number) => {
		const start = starts[index];
		return start === undefined ? undefined : code.slice(start);
	};
	// `}` and what follows it, its whitespace kept: `} .else {`.
	if (first.startsWith("}")) return { opcode: "}", operand: code.slice((starts[0] as number) + 1) || undefined };
	if (!isLabel()) return { opcode: first, operand: after(1) };
	if (second === undefined) return { label: first };
	return { label: first, opcode: second, operand: after(2) };

	function isLabel(): boolean {
		if (first.startsWith(".")) return false;
		// `start:`, `:`, `:loop`, a local label of another prefix (`!loop`).
		if (first.endsWith(":") || /^[:@!?~]/.test(first)) return true;
		if (isHead(first)) return false;
		// `HEIGHT = 5`, `* = $1000`, `start lda #0`.
		if (second !== undefined && ((second.startsWith("=") && !second.startsWith("==")) || second.startsWith(".") || isHead(second))) return true;
		return starts[0] === 0;
	}
}

/** The line's text for its fields. */
function layout(fields: Fields, depth: number, options: FormatOptions): string {
	const { tabSize } = options;
	const stop = (column: number) => (options.insertSpaces ? column : Math.ceil(column / tabSize) * tabSize);
	const indent = depth * tabSize;
	const opcodeColumn = stop(options.opcodeColumn) + indent;
	const operandColumn = stop(options.operandColumn) + indent;
	const commentColumn = stop(options.commentColumn);

	let text = fields.label ?? "";
	if (fields.opcode !== undefined) {
		text = padTo(text, opcodeColumn, options) + fields.opcode;
		if (fields.operand !== undefined) text = fields.opcode === "}" ? text + fields.operand : padTo(text, operandColumn, options) + fields.operand;
	}
	if (fields.comment !== undefined) text = padTo(text, commentColumn, options) + fields.comment;
	return text;
}

/** `text` and the whitespace up to `column`: to the next tab stop when it's already there, so a field is never glued. */
function padTo(text: string, column: number, options: FormatOptions): string {
	const { tabSize } = options;
	let at = width(text, tabSize);
	if (text !== "" && at >= column) column = (Math.floor(at / tabSize) + 1) * tabSize;
	if (options.insertSpaces) return text + " ".repeat(Math.max(0, column - at));
	let pad = "";
	while (at < column) {
		pad += "\t";
		at = (Math.floor(at / tabSize) + 1) * tabSize;
	}
	return text + pad;
}

/** The width of `text` on screen, its tabs going to the next tab stop. */
function width(text: string, tabSize: number): number {
	let at = 0;
	for (const char of text) at = char === "\t" ? (Math.floor(at / tabSize) + 1) * tabSize : at + 1;
	return at;
}

/** Whether `a` and `b` lex to the same tokens; true when `a` doesn't lex, as nothing can be checked then. */
export function sameTokens(a: string, b: string): boolean {
	const lex = (source: string): Token[] | undefined => {
		try {
			return new AssemblyLexer().tokenize(source);
		} catch {
			return undefined;
		}
	};
	const before = lex(a);
	if (!before) return true;
	const after = lex(b);
	if (!after || after.length !== before.length) return false;
	return before.every((token, index) => {
		const other = after[index] as Token;
		return token.type === other.type && JSON.stringify(token.value) === JSON.stringify(other.value) && token.raw === other.raw;
	});
}

/**
 * The words starting a statement in `source`, for `formatSource`: on each line the mnemonics of the CPU there (the last
 * `.cpu` above, else `cpu`, the project's; every CPU's for a file in no project), and the `macros`, in upper case.
 */
export function statementTest(source: string, language: { cpus: readonly StatementCpu[] }, cpu: string | undefined, macros: Iterable<string>): IsStatement {
	const macroNames = new Set(macros);
	const find = (name: string) => language.cpus.find(({ names }) => names.includes(name.replace(/^["']|["']$/g, "").toUpperCase()));
	const sets = new Map<StatementCpu | undefined, Set<string>>();
	const mnemonicsOf = (current: StatementCpu | undefined) => {
		let set = sets.get(current);
		if (!set) sets.set(current, (set = new Set((current ? [current] : language.cpus).flatMap(({ mnemonics }) => mnemonics))));
		return set;
	};
	// The CPU of each line, from 1.
	const cpus: (StatementCpu | undefined)[] = [undefined];
	let current = cpu === undefined ? undefined : find(cpu);
	for (const line of blankComments(source).split("\n")) {
		const match = /(?:^|\s)\.(?:cpu|setcpu|processor)\s+(\S+)/i.exec(line);
		current = (match && find(match[1] as string)) || current;
		cpus.push(current);
	}
	return (word, line) => macroNames.has(word) || mnemonicsOf(cpus[line]).has(word);
}
