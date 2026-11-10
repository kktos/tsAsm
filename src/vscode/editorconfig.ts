/**
 * editorconfig.ts
 *
 * * The `.editorconfig` properties of a file (editorconfig.org): its `.editorconfig` files from its folder up to one with
 *   `root = true`, a closer one overriding a farther one, a later section overriding an earlier one.
 * * The formatter's settings from them: `indent_style`, `tab_width` and `indent_size` as EditorConfig defines them, a
 *   value it doesn't know ignored as it says; the `tsasm_*` keys, which are tsAsm's: a bad value or an unknown key is an
 *   error, not ignored.
 * * Without the vscode module, so it can be tested.
 */

import { dirname, join, relative, sep } from "node:path";
import type { FormatOptions } from "./format";

/** A property: its value, the `.editorconfig` and the line (from 1) where it's set. */
export interface Property {
	value: string;
	file: string;
	line: number;
}

/** An error in an `.editorconfig`, where it is. */
export class EditorConfigError extends Error {
	constructor(
		message: string,
		readonly file: string,
		readonly line: number,
	) {
		super(message);
	}
}

/** Reads a file: undefined when there's none. */
export type ReadFile = (path: string) => string | undefined;

/** The properties of `file` (an absolute path), by name in lower case. */
export function editorConfigFor(file: string, readFile: ReadFile): Map<string, Property> {
	// The `.editorconfig` files, the closest first, up to a root one.
	const configs: { path: string; sections: Section[] }[] = [];
	for (let dir = dirname(file); ; dir = dirname(dir)) {
		const path = join(dir, ".editorconfig");
		const text = readFile(path);
		if (text !== undefined) {
			const parsed = parse(text, path);
			configs.push({ path, sections: parsed.sections });
			if (parsed.root) break;
		}
		if (dirname(dir) === dir) break;
	}

	const properties = new Map<string, Property>();
	for (const { path, sections } of configs.reverse()) {
		const relativePath = relative(dirname(path), file).split(sep).join("/");
		for (const section of sections) {
			if (!section.pattern.test(relativePath)) continue;
			for (const [name, property] of section.properties) {
				if (property.value === "unset") properties.delete(name);
				else properties.set(name, property);
			}
		}
	}
	return properties;
}

interface Section {
	pattern: RegExp;
	properties: Map<string, Property>;
}

/** An `.editorconfig`'s sections, and whether it's a root one. */
function parse(text: string, file: string): { root: boolean; sections: Section[] } {
	const sections: Section[] = [];
	let root = false;
	text.split(/\r?\n/).forEach((raw, index) => {
		const line = raw.trim();
		if (line === "" || line.startsWith("#") || line.startsWith(";")) return;
		const header = /^\[(.*)\]$/.exec(line);
		if (header) {
			sections.push({ pattern: globPattern(header[1] as string), properties: new Map() });
			return;
		}
		const equal = line.indexOf("=");
		// EditorConfig ignores a line it can't read: the `tsasm_*` ones are checked when they're used.
		if (equal < 0) return;
		const name = line.slice(0, equal).trim().toLowerCase();
		const value = line.slice(equal + 1).trim();
		const section = sections.at(-1);
		if (!section) {
			if (name === "root") root = value.toLowerCase() === "true";
			return;
		}
		section.properties.set(name, { value, file, line: index + 1 });
	});
	return { root, sections };
}

/**
 * A section's glob as a pattern on a path relative to its `.editorconfig`, with `/`: `*` any chars but `/`, `**` any
 * chars, `?` one char but `/`, `[abc]`, `[!abc]`, `{a,b}`, `{1..3}`, `\` escaping a char. A glob without `/` matches a
 * file's name in any folder.
 */
export function globPattern(glob: string): RegExp {
	const anywhere = !glob.includes("/");
	const source = glob.startsWith("/") ? glob.slice(1) : glob;
	return new RegExp(`^${anywhere ? "(?:.*/)?" : ""}${globSource(source)}$`);
}

function globSource(glob: string): string {
	let pattern = "";
	let i = 0;
	while (i < glob.length) {
		const char = glob[i++] as string;
		if (char === "\\") pattern += escapeRegExp(glob[i++] ?? "\\");
		else if (char === "*") {
			if (glob[i] === "*") {
				i++;
				pattern += ".*";
			} else pattern += "[^/]*";
		} else if (char === "?") pattern += "[^/]";
		else if (char === "[") {
			const end = glob.indexOf("]", i);
			const set = end < 0 ? "" : glob.slice(i, end);
			if (end < 0 || set === "" || set.includes("/")) pattern += "\\[";
			else {
				const negated = set.startsWith("!");
				pattern += `[${negated ? "^" : ""}${(negated ? set.slice(1) : set).replace(/[\\\]^]/g, "\\$&")}]`;
				i = end + 1;
			}
		} else if (char === "{") {
			const end = closingBrace(glob, i);
			const body = end < 0 ? "" : glob.slice(i, end);
			const range = /^(-?\d+)\.\.(-?\d+)$/.exec(body);
			const options = splitTopLevel(body);
			if (range) {
				const [from, to] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b) as [number, number];
				pattern += `(?:${Array.from({ length: Math.min(to - from + 1, 10000) }, (_, n) => String(from + n)).join("|")})`;
				i = end + 1;
			} else if (end >= 0 && options.length > 1) {
				pattern += `(?:${options.map(globSource).join("|")})`;
				i = end + 1;
			} else pattern += "\\{";
		} else pattern += escapeRegExp(char);
	}
	return pattern;
}

/** Where the `}` closing a `{` before `from` is: -1 when there's none. */
function closingBrace(glob: string, from: number): number {
	let depth = 1;
	for (let i = from; i < glob.length; i++) {
		if (glob[i] === "\\") i++;
		else if (glob[i] === "{") depth++;
		else if (glob[i] === "}" && --depth === 0) return i;
	}
	return -1;
}

/** `a,{b,c},d` → `a`, `{b,c}`, `d`. */
function splitTopLevel(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < body.length; i++) {
		if (body[i] === "\\") i++;
		else if (body[i] === "{") depth++;
		else if (body[i] === "}") depth--;
		else if (body[i] === "," && depth === 0) {
			parts.push(body.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(body.slice(start));
	return parts;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

const COLUMNS = { tsasm_opcode_column: "opcodeColumn", tsasm_operand_column: "operandColumn", tsasm_comment_column: "commentColumn" } as const;

/** The formatter's settings `properties` give; throws an `EditorConfigError` on a `tsasm_*` key it doesn't know or a bad value. */
export function formatSettings(properties: Map<string, Property>): Partial<FormatOptions> {
	const settings: Partial<FormatOptions> = {};
	const size = (name: string) => {
		const value = properties.get(name)?.value;
		return value !== undefined && /^[1-9]\d*$/.test(value) ? Number(value) : undefined;
	};
	const style = properties.get("indent_style")?.value.toLowerCase();
	if (style === "tab" || style === "space") settings.insertSpaces = style === "space";
	// With spaces, an indentation level is `indent_size`; with tabs, a tab is `tab_width`, each defaulting to the other.
	const tabWidth = size("tab_width");
	const indentSize = size("indent_size");
	const tabSize = settings.insertSpaces ? (indentSize ?? tabWidth) : (tabWidth ?? indentSize);
	if (tabSize !== undefined) settings.tabSize = tabSize;

	for (const [name, { value, file, line }] of properties) {
		if (!name.startsWith("tsasm_")) continue;
		if (name in COLUMNS) {
			if (!/^\d+$/.test(value)) throw new EditorConfigError(`${name} = ${value}: a column is a whole number, from 0.`, file, line);
			settings[COLUMNS[name as keyof typeof COLUMNS]] = Number(value);
		} else if (name === "tsasm_indent_blocks") {
			const flag = value.toLowerCase();
			if (flag !== "true" && flag !== "false") throw new EditorConfigError(`${name} = ${value}: it's true or false.`, file, line);
			settings.indentBlocks = flag === "true";
		} else {
			const known = [...Object.keys(COLUMNS), "tsasm_indent_blocks"].join(", ");
			throw new EditorConfigError(`Unknown key ${name}: the tsAsm keys are ${known}.`, file, line);
		}
	}
	return settings;
}
