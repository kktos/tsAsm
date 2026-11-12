/**
 * links.ts
 *
 * * The file paths of a source the VS Code extension links to: `.include`, `.incbin` and `.define … from`; in a linker
 *   script, `.include`.
 * * Without the vscode module, so it can be tested.
 */

/** A path in the source: `start` and `end` are the offsets of its text, between the quotes. */
export type FileLink = { start: number; end: number; path: string };

const STRING = String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')`;
/** The start of a statement and its label, if any: a label doesn't start with a dot. */
const HEAD = String.raw`(?:^|[{}])[ \t]*(?:[^\s.{}][^\s{}]*[ \t]+)?`;
const END = String.raw`[ \t]*(?=$|[{}])`;

const STATEMENTS = [
	new RegExp(String.raw`${HEAD}\.(?:include|incbin)[ \t]+${STRING}${END}`, "gim"),
	new RegExp(String.raw`${HEAD}\.define[ \t]+[A-Za-z_]\w*(?:[ \t]+as[ \t]+[A-Za-z_]\w*)?[ \t]+from[ \t]+${STRING}${END}`, "gim"),
];
const LINKER_STATEMENTS = [new RegExp(String.raw`${HEAD}\.include[ \t]+${STRING}${END}`, "gim")];

/**
 * The paths written as a string alone: one built by an expression (`"gfx/" + name`) is only known when it's assembled.
 * A path is relative to the file it's in, as the assembler reads it, except in a macro body: there it's relative to
 * the file the macro is called from, which only the assembly knows. A linker script's comments start with `#`, not `;`.
 */
export function findFileLinks(source: string, { linker = false } = {}): FileLink[] {
	const text = blankComments(source, linker ? "#" : ";");
	const links: FileLink[] = [];
	for (const statement of linker ? LINKER_STATEMENTS : STATEMENTS) {
		for (const match of text.matchAll(statement)) {
			const literal = match[1] as string;
			const start = match.index + match[0].lastIndexOf(literal) + 1;
			links.push({ start, end: start + literal.length - 2, path: unescape(literal.slice(1, -1)) });
		}
	}
	return links.sort((a, b) => a.start - b.start);
}

/**
 * The source with its comments made spaces, its line breaks kept: a path in a comment isn't linked, and the offsets stay.
 * A line comment starts with `commentChar` or `//`.
 */
export function blankComments(source: string, commentChar = ";"): string {
	let text = "";
	let quote: string | undefined;
	for (let i = 0; i < source.length; i++) {
		const char = source[i] as string;
		if (quote) {
			if (char === "\\" && source[i + 1] !== "\n") {
				text += char + (source[++i] ?? "");
				continue;
			}
			if (char === quote || char === "\n") quote = undefined;
			text += char;
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === commentChar || source.startsWith("//", i) || source.startsWith("/*", i)) {
			const block = source.startsWith("/*", i);
			const end = block ? source.indexOf("*/", i + 2) : source.indexOf("\n", i);
			const stop = end < 0 ? source.length : block ? end + 2 : end;
			text += source.slice(i, stop).replace(/[^\n]/g, " ");
			i = stop - 1;
			continue;
		}
		text += char;
	}
	return text;
}

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };

function unescape(text: string): string {
	return text.replace(/\\(x[0-9A-Fa-f]{2}|.)/g, (_, escape: string) =>
		escape.length === 3 ? String.fromCharCode(Number.parseInt(escape.slice(1), 16)) : (ESCAPES[escape] ?? escape),
	);
}
