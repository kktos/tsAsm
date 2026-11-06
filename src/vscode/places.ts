/**
 * places.ts
 *
 * * Where a name is in a line, for the VS Code extension: its columns, from what the assembler tells, a line and a column.
 * * Without the vscode module, so it can be tested.
 */

/** A place in a file: its absolute path, and its line and columns, from 1, `endColumn` after its last char. */
export interface Place {
	file: string;
	line: number;
	column: number;
	endColumn: number;
}

/** An anonymous label reference, a string, or a run of chars that aren't spaces, separators or operators. */
const TOKEN = /:[-+]+\d*|"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[^\s,;()[\]{}+\-*/<>=&|^~]+/y;

/**
 * The columns of the token at `column` in `text`, from 1, the end after its last char: the whole line, but its
 * indentation, without a column; at least one char.
 */
export function tokenSpan(text: string, column: number | undefined): [number, number] {
	if (column === undefined) {
		const start = text.search(/\S/) + 1 || 1;
		return [start, Math.max(start + 1, text.trimEnd().length + 1)];
	}
	TOKEN.lastIndex = column - 1;
	// A label's colon isn't part of its name: `start:` is `start`, `:l` stays.
	const token = TOKEN.exec(text)?.[0].replace(/(?<=.):$/, "") ?? "";
	return [column, column + Math.max(1, token.length)];
}

/** The place of a name defined at `column` in `text`: its token, or, after a directive (`.macro clear`), its name further on. */
export function nameSpan(text: string, column: number, name: string): [number, number] {
	const span = tokenSpan(text, column);
	const short = name.split(/[.:]/).findLast((part) => part !== "");
	if (!short) return span;
	// `start`, `:loop`, `!loop`: the token is the name, after a local label's prefix.
	const token = text.slice(span[0] - 1, span[1] - 1);
	if (token.replace(/^[^A-Za-z_]+/, "").toUpperCase() === short.toUpperCase()) return span;
	const match = new RegExp(`(?<![\\w.])${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "i").exec(text.slice(column - 1));
	return match ? [column + match.index, column + match.index + short.length] : span;
}
