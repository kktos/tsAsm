/**
 * rename.ts
 *
 * * Renaming a symbol: at its definition and at the references the assembly read, and, to confirm, where its name is
 *   written in what the assembly didn't read (an `.if` branch not taken, a macro never called, `.def(name)`).
 * * Refused, saying why, where it could change what a name refers to: a name built by an expression, a name in a macro
 *   body that refers to another symbol at another call, a new name that clashes or shadows (`checkRenamed`, on the
 *   project assembled with the new name).
 * * Without the vscode module, so it can be tested.
 */

import { scanBlocks } from "../format/blocks";
import { blankComments } from "../format/comments";
import { analyse, type Files } from "./analysis";
import type { Place } from "./places";
import { type IndexEntry, type SymbolIndex, symbolKey } from "./symbol-index";

/** Why a rename is refused: its message is shown as is. */
export class RenameError extends Error {}

/** A file's text, by its absolute path; undefined when it can't be read. */
export type TextOf = (file: string) => string | undefined;
/** A path as the messages write it. */
export type Relative = (file: string) => string;

export interface RenameEdit {
	/** The name's chars: a local label's after its prefix, a qualified name's after its namespace. */
	place: Place;
	text: string;
	/** Found in text the assembly didn't read: to confirm. */
	unread: boolean;
}

/** The symbol the name at the cursor refers to, and where its name is written. */
export interface RenameSymbol {
	entries: IndexEntry[];
	/** Its name at the cursor. */
	place: Place;
	/** Its name there, as written, without a local label's prefix. */
	name: string;
	/** A local label's prefix, `:`, `@`: a new name typed with it is the same. */
	prefix: string;
	/** Its definition and the references the assembly read. */
	places: Place[];
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const placeKey = ({ file, line, column }: Place) => `${file}:${line}:${column}`;
const lineOf = (text: string | undefined, line: number) => text?.split("\n")[line - 1]?.replace(/\r$/, "") ?? "";

/** A symbol's name for the messages: `GFX::SPRITE`, `START.LOOP`. */
function display({ symbol }: IndexEntry): string {
	const scoped = symbol.namespace && !/^(macro|function|proc) /.test(symbol.namespace);
	return scoped ? `${symbol.namespace}::${symbol.name}` : symbol.name;
}

/** The last part of a symbol's name, the one written: `LOOP` of `START.LOOP`. */
const shortName = ({ symbol }: IndexEntry) => symbol.name.split(/::|\./).at(-1) ?? symbol.name;

/**
 * Where `entry`'s name is in the text at `place`: `sprite` in `gfx::sprite`, `levels` in `levels.a`, `loop` in
 * `:loop`; undefined when it isn't written there, its name built by an expression.
 */
export function nameIn(place: Place, entry: IndexEntry, text: string): Place | undefined {
	const token = text.slice(place.column - 1, place.endColumn - 1);
	const separator = token.lastIndexOf("::");
	const from = separator < 0 ? 0 : separator + 2;
	const short = shortName(entry).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`(?<![A-Za-z0-9_])${short}(?![A-Za-z0-9_])`, "i").exec(token.slice(from));
	if (!match) return undefined;
	const column = place.column + from + match.index;
	return { file: place.file, line: place.line, column, endColumn: column + match[0].length };
}

/**
 * What a rename at `column` of `entries`' name (the name at the cursor, in every project) renames, and where: refused
 * for an anonymous label, a name referring to several symbols, a name not written as itself.
 */
export function renameSymbol(indexes: SymbolIndex[], entries: IndexEntry[], column: number, textOf: TextOf, relative: Relative): RenameSymbol {
	const [first] = entries;
	if (!first) throw new RenameError("No symbol here: only a name the last assembly read can be renamed.");
	if (first.symbol.kind === "anonymous label") throw new RenameError("An anonymous label has no name to rename.");
	const keys = new Set(entries.map(symbolKey));
	if (keys.size > 1) {
		const names = [...new Set(entries.map(display))].join(", ");
		throw new RenameError(`This name refers to several symbols, at different macro calls: ${names}. Renaming it would rename them all.`);
	}

	const where = (place: Place) => `${relative(place.file)}:${place.line}`;
	const span = (place: Place) => {
		const text = lineOf(textOf(place.file), place.line);
		const name = nameIn(place, first, text);
		if (!name) {
			const written = text.slice(place.column - 1, place.endColumn - 1);
			throw new RenameError(`${display(first)} is written \`${written}\` at ${where(place)}: a name built by an expression can't be renamed.`);
		}
		return name;
	};

	const at = span(first.place);
	const text = lineOf(textOf(at.file), at.line);
	const name = text.slice(at.column - 1, at.endColumn - 1);
	// The cursor on `gfx` of `gfx::sprite`, on `a` of `levels.a`: a local label's prefix is its name's.
	const qualifier = text.slice(first.place.column - 1, at.column - 1);
	if ((qualifier.includes("::") && column < at.column) || column > at.endColumn) throw new RenameError(`Only \`${name}\` here is a symbol's name.`);

	// Its definition and its references, each once, and each a name of this symbol only.
	const places = new Map<string, Place>();
	for (const index of indexes) {
		for (const entry of index.entriesOf(keys)) {
			for (const place of entry.definition ? [entry.target] : [entry.place, entry.target]) {
				if (places.has(placeKey(place))) continue;
				const other = indexes
					.flatMap((each) => each.at(place.file, place.line, place.column))
					.find((found) => !keys.has(symbolKey(found)) && found.place.column === place.column);
				if (other)
					throw new RenameError(
						`\`${display(first)}\` at ${where(place)} also refers to ${display(other)}, at another macro call: renaming it there would change that one too.`,
					);
				places.set(placeKey(place), span(place));
			}
		}
	}

	const definition = span(first.target);
	const prefix =
		first.symbol.kind === "label" && first.symbol.name.includes(".")
			? lineOf(textOf(definition.file), definition.line).slice(first.target.column - 1, definition.column - 1)
			: "";
	return { entries, place: at, name, prefix, places: [...places.values()] };
}

/** The new name, without a local label's prefix if it's typed with it: refused when it isn't a name. */
export function newNameOf(symbol: RenameSymbol, typed: string): string {
	const name = symbol.prefix && typed.startsWith(symbol.prefix) ? typed.slice(symbol.prefix.length) : typed.trim();
	if (!NAME.test(name)) throw new RenameError(`\`${typed}\` isn't a name: a letter or \`_\`, then letters, digits or \`_\`.`);
	return name;
}

/**
 * The edits renaming `symbol` to `newName`: its places, and where its name is written in `sources` (each file's text)
 * at no place of `indexes`, the assembly not having read it there, to confirm. A local label's are looked for under
 * its global label only, written with its prefix.
 */
export function renameEdits(symbol: RenameSymbol, newName: string, indexes: SymbolIndex[], sources: Map<string, string>): RenameEdit[] {
	const edits: RenameEdit[] = symbol.places.map((place) => ({ place, text: newName, unread: false }));
	const [first] = symbol.entries as [IndexEntry];
	const short = shortName(first);

	// The lines under the global label of a local label: up to the next global label's definition.
	let region: { file: string; from: number; to: number } | undefined;
	if (symbol.prefix) {
		const global = first.symbol.name.split(".")[0]?.split("::").at(-1);
		const labels = indexes
			.flatMap((index) => index.definitions(first.target.file))
			.filter(({ symbol: { kind, name } }) => kind === "label" && !name.includes("."));
		const own = labels.find(({ symbol: { name } }) => name.split("::").at(-1) === global);
		const from = own?.target.line ?? 1;
		const next = labels.map(({ target }) => target.line).filter((line) => line > from);
		region = { file: first.target.file, from, to: next.length > 0 ? Math.min(...next) : Number.POSITIVE_INFINITY };
	}

	// A name the assembly read is in an index, this symbol's or another's: `:loop` under another global label.
	const indexed = (file: string, line: number, column: number, endColumn: number) =>
		indexes.some((index) => index.entriesIn(file).some(({ place }) => place.line === line && place.column < endColumn && column < place.endColumn));

	for (const [file, source] of sources) {
		if (region && file !== region.file) continue;
		const lines = searchable(source).split("\n");
		const pattern = new RegExp(`(?<![A-Za-z0-9_])${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_])`, "gi");
		lines.forEach((text, index) => {
			const line = index + 1;
			if (region && (line < region.from || line >= region.to)) return;
			for (const match of text.matchAll(pattern)) {
				const column = match.index + 1;
				const before = text.slice(0, match.index);
				if (symbol.prefix ? !before.endsWith(symbol.prefix) : !standsAlone(before)) continue;
				if (indexed(file, line, column, column + match[0].length)) continue;
				edits.push({ place: { file, line, column, endColumn: column + match[0].length }, text: newName, unread: true });
			}
		});
	}
	return edits;
}

/** Whether a name after `before` is a name of its own: not a field (`.x`), a local label (`:x`), but `ns::x`. */
function standsAlone(before: string): boolean {
	return !/[.!@$]$/.test(before) && (!before.endsWith(":") || before.endsWith("::"));
}

/** `source` with its comments, strings and raw blocks (`.define`, `.hex`) made spaces: a name there isn't one. */
function searchable(source: string): string {
	const lines = blankComments(source)
		.replace(/"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/g, (string) => " ".repeat(string.length))
		.split("\n");
	for (const block of scanBlocks(source)) {
		if (block.kind !== "define" && block.kind !== "hex") continue;
		// The raw text, after its first line, up to its last: `.define t [1, 2]` is a line of its own.
		for (let line = block.start.line + 1; line < block.end.line; line++) lines[line - 1] = " ".repeat(lines[line - 1]?.length ?? 0);
	}
	return lines.join("\n");
}

/** `text` with `edits` (in this file) made. */
export function applyEdits(text: string, edits: RenameEdit[]): string {
	const lines = text.split("\n");
	const sorted = [...edits].sort((a, b) => b.place.line - a.place.line || b.place.column - a.place.column);
	for (const { place, text: name } of sorted) {
		const line = lines[place.line - 1] ?? "";
		lines[place.line - 1] = line.slice(0, place.column - 1) + name + line.slice(place.endColumn - 1);
	}
	return lines.join("\n");
}

/** `place` once `edits` are made: on its line, its columns move by the edits before them. */
export function editedPlace(place: Place, edits: RenameEdit[]): Place {
	const moved = (column: number) =>
		column +
		edits
			.filter((edit) => edit.place.file === place.file && edit.place.line === place.line && edit.place.endColumn <= column)
			.reduce((delta, edit) => delta + edit.text.length - (edit.place.endColumn - edit.place.column), 0);
	return { ...place, column: moved(place.column), endColumn: moved(place.endColumn) };
}

/**
 * Why the rename made by `edits` changes what a name refers to, comparing the project's index `before` and `after` it;
 * undefined when every name refers to what it did: the new name doesn't clash or shadow, and isn't taken for another.
 */
export function checkRenamed(before: SymbolIndex, after: SymbolIndex, edits: RenameEdit[], textOf: TextOf, relative: Relative): string | undefined {
	const signature = (place: Place, entry: IndexEntry, target: Place) =>
		JSON.stringify([place.file, place.line, place.column, place.endColumn, entry.symbol.kind, target.file, target.line, target.column]);
	const was = new Map<string, IndexEntry>();
	for (const entry of before.all()) was.set(signature(editedPlace(entry.place, edits), entry, editedPlace(entry.target, edits)), entry);
	const is = new Map<string, IndexEntry>();
	for (const entry of after.all()) is.set(signature(entry.place, entry, entry.target), entry);

	const where = (place: Place) => `${relative(place.file)}:${place.line}`;
	const written = (place: Place) => lineOf(textOf(place.file), place.line).slice(place.column - 1, place.endColumn - 1);
	const order = (a: IndexEntry, b: IndexEntry) => a.place.file.localeCompare(b.place.file) || a.place.line - b.place.line || a.place.column - b.place.column;

	const lost = [...was]
		.filter(([key]) => !is.has(key))
		.map(([, entry]) => entry)
		.sort(order)[0];
	if (lost) {
		const place = editedPlace(lost.place, edits);
		const now = after.all().find((entry) => entry.place.file === place.file && entry.place.line === place.line && entry.place.column === place.column);
		const name = `\`${written(place)}\` at ${where(place)}`;
		if (now) return `Renamed, ${name} would refer to ${display(now)} (${where(now.target)}), not ${display(lost)}.`;
		return `Renamed, ${name} would no longer refer to ${display(lost)}.`;
	}
	const gained = [...is]
		.filter(([key]) => !was.has(key))
		.map(([, entry]) => entry)
		.sort(order)[0];
	if (gained) return `Renamed, \`${written(gained.place)}\` at ${where(gained.place)} would refer to ${display(gained)} (${where(gained.target)}).`;
	return undefined;
}

/** A project the rename is checked on: its index, from its last assembly, and the source files it read. */
export interface RenameProject {
	path: string;
	index: SymbolIndex;
	sources: Iterable<string>;
}

/**
 * The edits renaming `symbol` to `typed`, in the `projects` having it (their files read from `files`): refused when,
 * assembled with them, one of them fails or a name in it refers to something else.
 */
export function renameProjects(projects: RenameProject[], symbol: RenameSymbol, typed: string, files: Files, relative: Relative): RenameEdit[] {
	const name = newNameOf(symbol, typed);
	const keys = new Set(symbol.entries.map(symbolKey));
	const having = projects.filter(({ index }) => index.entriesOf(keys).length > 0);
	const sources = new Map<string, string>();
	for (const { sources: paths } of having) {
		for (const path of paths) {
			const text = readText(files, path);
			if (text !== undefined) sources.set(path, text);
		}
	}
	const edits = renameEdits(
		symbol,
		name,
		having.map(({ index }) => index),
		sources,
	);
	const renamed = renamedFiles(files, edits);
	for (const { path, index } of having) {
		const analysis = analyse(path, renamed);
		if (!analysis.index) {
			const error = analysis.diagnostics.find(({ severity }) => severity === "error");
			const why = error ? `: ${error.message} (${relative(error.file)}:${error.line})` : ".";
			throw new RenameError(`Renamed, ${relative(path)} wouldn't assemble${why}`);
		}
		const why = checkRenamed(index, analysis.index, edits, (file) => readText(renamed, file), relative);
		if (why) throw new RenameError(why);
	}
	return edits;
}

/** `files` with `edits` made. */
function renamedFiles(files: Files, edits: RenameEdit[]): Files {
	return {
		readText(path) {
			const text = files.readText(path);
			const own = edits.filter(({ place }) => place.file === path);
			return own.length > 0 ? applyEdits(text, own) : text;
		},
		readBytes: (path) => files.readBytes(path),
	};
}

/** A file's text, undefined when it can't be read. */
export function readText(files: Files, path: string): string | undefined {
	try {
		return files.readText(path);
	} catch {
		return undefined;
	}
}
