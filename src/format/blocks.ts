/**
 * blocks.ts
 *
 * * The blocks of a source, read from its text as the parser reads them: `.macro`, `.proc`, `.function`, `.if`,
 *   `.repeat`, `.for`, `.struct` up to their `.end` or in `{ }`, `.namespace` up to `.end namespace`, the raw blocks of
 *   `.define` and `.hex`, and the `.segment` selections. Their extents, which the assembly doesn't tell.
 * * From the text alone: it works while a file doesn't assemble, and for a file in no project.
 * * Without the vscode module: shared by the VS Code extension and the CLI.
 */

import { blankComments } from "./comments";

export type BlockKind = "macro" | "proc" | "function" | "namespace" | "if" | "loop" | "struct" | "define" | "hex" | "segment";

/** A line and a column, from 1. */
export interface Position {
	line: number;
	column: number;
}

export interface Block {
	kind: BlockKind;
	/** Its name, as written: a macro's, a proc's, a function's, a struct's, a namespace's, a segment's, a `.define`'s. */
	name?: string;
	/** Where its name is, `nameEnd` after its last char. */
	nameStart?: Position;
	nameEnd?: Position;
	/** Where its directive is. */
	start: Position;
	/** After its last char: its `.end` line's, its `}`. A segment's is its line's: it's a selection, not a block. */
	end: Position;
	/** Whether its `.end` or `}` was found: else it runs to the end of the file. */
	closed: boolean;
	/** An `.if`'s `.elseif` and `.else`, where they are, when it ends with `.end`: in braces, each branch is a block. */
	branches?: Position[];
}

interface Token {
	type: "word" | "string" | "{" | "}" | "newline";
	text: string;
	line: number;
	column: number;
	/** After its last char. */
	endColumn: number;
}

/** The words, strings, braces and line breaks of the text, its comments blanked. */
function tokenize(source: string): Token[] {
	const text = blankComments(source);
	const tokens: Token[] = [];
	let line = 1;
	let lineStart = 0;
	let i = 0;
	while (i < text.length) {
		const char = text[i] as string;
		const column = i - lineStart + 1;
		if (char === "\n") {
			tokens.push({ type: "newline", text: char, line, column, endColumn: column + 1 });
			line++;
			lineStart = ++i;
			continue;
		}
		if (/\s/.test(char)) {
			i++;
			continue;
		}
		if (char === "{" || char === "}") {
			tokens.push({ type: char, text: char, line, column, endColumn: column + 1 });
			i++;
			continue;
		}
		const start = i;
		if (char === '"' || char === "'") {
			i++;
			while (i < text.length && text[i] !== char && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
			if (text[i] === char) i++;
		} else while (i < text.length && !/[\s{}"']/.test(text[i] as string)) i++;
		tokens.push({ type: char === '"' || char === "'" ? "string" : "word", text: text.slice(start, i), line, column, endColumn: column + i - start });
	}
	return tokens;
}

const BLOCK_KINDS: Record<string, BlockKind> = {
	MACRO: "macro",
	PROC: "proc",
	PROCEDURE: "proc",
	FUNCTION: "function",
	FN: "function",
	IF: "if",
	FOR: "loop",
	REPEAT: "loop",
	STRUCT: "struct",
};

/** An open block: how it's closed, `.end` or `}`; a namespace by `.end namespace`, `.namespace global` or the file's end. */
interface Open {
	block: Block;
	closer: "end" | "brace" | "namespace";
}

/** The blocks of `source`, by where they start. */
export function scanBlocks(source: string): Block[] {
	const tokens = tokenize(source);
	const blocks: Block[] = [];
	const open: Open[] = [];
	let i = 0;

	const close = (entry: Open, end: Position) => {
		entry.block.end = end;
		entry.block.closed = true;
	};
	/** Closes the namespaces opened in the innermost block, or at the top: a block's end closes those opened in it too. */
	const closeNamespaces = (end: Position, innermostOnly: boolean) => {
		while (open.at(-1)?.closer === "namespace") {
			close(open.pop() as Open, end);
			if (innermostOnly) return;
		}
	};
	/** Skips the tokens up to the `}` matching one just read, and gives the position after it. */
	const skipBraces = (): Position => {
		let depth = 1;
		while (i < tokens.length) {
			const token = tokens[i++] as Token;
			if (token.type === "{") depth++;
			else if (token.type === "}" && --depth === 0) return { line: token.line, column: token.endColumn };
		}
		return endOfFile();
	};
	/** Skips the lines up to one starting with `.end`, and gives the position after it: a raw block's end. */
	const skipToEndLine = (): Position | undefined => {
		while (i < tokens.length) {
			const token = tokens[i++] as Token;
			const first = token.type === "word" && (tokens[i - 2]?.type === "newline" || i === 1);
			if (first && token.text.toLowerCase() === ".end") return lineEnd();
		}
		return undefined;
	};
	/** Skips the rest of the line, and gives the position after its last token. */
	const lineEnd = (): Position => {
		let last = tokens[i - 1] as Token;
		while (i < tokens.length && tokens[i]?.type !== "newline") last = tokens[i++] as Token;
		return { line: last.line, column: last.endColumn };
	};
	const endOfFile = (): Position => {
		const last = tokens.findLast((token) => token.type !== "newline");
		return last ? { line: last.line, column: last.endColumn } : { line: 1, column: 1 };
	};

	while (i < tokens.length) {
		// A statement: up to a line break or a brace.
		const statement: Token[] = [];
		while (i < tokens.length && (tokens[i] as Token).type !== "newline" && (tokens[i] as Token).type !== "{" && (tokens[i] as Token).type !== "}")
			statement.push(tokens[i++] as Token);
		const terminator = tokens[i];
		if (terminator) i++;

		const handled = statement.length > 0 && handleStatement(statement, terminator);
		if (handled || !terminator) continue;
		if (terminator.type === "{") skipBraces();
		else if (terminator.type === "}") {
			const index = open.findLastIndex((entry) => entry.closer === "brace");
			if (index < 0) continue;
			const end = { line: terminator.line, column: terminator.endColumn };
			while (open.length > index) close(open.pop() as Open, end);
		}
	}
	for (const entry of open) entry.block.end = endOfFile();
	return blocks.sort((a, b) => a.start.line - b.start.line || a.start.column - b.start.column);

	/** A statement with a directive: whether it took its `{`, `}` or line break as its own. */
	function handleStatement(statement: Token[], terminator: Token | undefined): boolean {
		// The directive, after a label if any.
		const at = statement[0]?.text.startsWith(".") ? 0 : statement[1]?.text.startsWith(".") ? 1 : -1;
		const directiveToken = statement[at];
		if (!directiveToken || !/^\.\w+$/.test(directiveToken.text)) return false;
		const directive = directiveToken.text.slice(1).toUpperCase();
		const operands = statement.slice(at + 1);
		const start = { line: directiveToken.line, column: directiveToken.column };
		const braced = terminator?.type === "{";
		const statementEnd = { line: directiveToken.line, column: (statement.at(-1) as Token).endColumn };
		const block = (kind: BlockKind, nameToken?: Token): Block => {
			const result: Block = { kind, start, end: start, closed: false };
			if (nameToken) {
				const name = nameToken.text.replace(/\(.*$/, "");
				result.name = name;
				result.nameStart = { line: nameToken.line, column: nameToken.column };
				result.nameEnd = { line: nameToken.line, column: nameToken.column + name.length };
			}
			blocks.push(result);
			return result;
		};

		switch (directive) {
			case "END": {
				if (operands[0]?.text.toUpperCase() === "NAMESPACE") {
					closeNamespaces(statementEnd, true);
					return false;
				}
				const index = open.findLastIndex((entry) => entry.closer === "end");
				while (index >= 0 && open.length > index) close(open.pop() as Open, statementEnd);
				return false;
			}
			case "ELSE":
			case "ELSEIF": {
				// `} .else {`: the branch is a block of the `.if`.
				if (braced) {
					open.push({ block: block("if"), closer: "brace" });
					return true;
				}
				const owner = open.findLast((entry) => entry.closer === "end")?.block;
				if (owner?.kind === "if") (owner.branches ??= []).push(start);
				return false;
			}
			case "NAMESPACE": {
				const name = operands[0];
				if (!name || name.text.toLowerCase() === "global") {
					closeNamespaces({ line: directiveToken.line, column: directiveToken.column }, false);
					return false;
				}
				open.push({ block: block("namespace", name), closer: braced ? "brace" : "namespace" });
				return braced;
			}
			case "SEGMENT": {
				const marker = block("segment", operands[0]);
				marker.closed = true;
				// Its braces are its definition, `{ start: $0800 }`, not code.
				marker.end = braced ? skipBraces() : statementEnd;
				return braced;
			}
			case "DEFINE":
			case "HEX": {
				if (directive === "DEFINE" && operands.some((token) => token.text.toUpperCase() === "FROM")) return false;
				const raw = block(directive === "DEFINE" ? "define" : "hex", directive === "DEFINE" ? operands[0] : undefined);
				// The raw text starts after the name and its format: `.define table AS JSON`.
				const headLength = directive === "HEX" ? 0 : operands[1]?.text.toUpperCase() === "AS" ? 3 : 1;
				if (braced) {
					raw.end = skipBraces();
					raw.closed = true;
					return true;
				}
				if (operands.length > headLength || terminator?.type !== "newline") {
					// One line: `.hex 01 02`, `.define t [1, 2]`.
					raw.end = statementEnd;
					raw.closed = true;
					return false;
				}
				const end = skipToEndLine();
				raw.end = end ?? endOfFile();
				raw.closed = end !== undefined;
				return true;
			}
		}

		const kind = BLOCK_KINDS[directive];
		if (!kind) return false;
		// `.function f(x) = x * 2` is one line.
		if (kind === "function" && operands.some((token) => token.text.includes("="))) return false;
		const named = kind === "macro" || kind === "proc" || kind === "function" || kind === "struct";
		open.push({ block: block(kind, named ? operands[0] : undefined), closer: braced ? "brace" : "end" });
		return braced;
	}
}
