/**
 * symbol-index.ts
 *
 * * Where a project's names are, and what each one refers to: from the assembler's `onSymbolReference`.
 * * The places follow the edits made since the assembly, so they stay right while a file doesn't assemble.
 * * Without the vscode module, so it can be tested.
 */

import type { SymbolInfo } from "../assembler/polyasm.types";
import { RelocValue } from "../assembler/reloc-value.class";
import type { SymbolValue } from "../assembler/symbol.class";
import { getHex } from "../utils/hex.util";
import type { Place } from "./places";

/** A name in a file: `place` is where it's written, `target` where what it refers to is defined, the same for a definition. */
export interface IndexEntry {
	place: Place;
	definition: boolean;
	symbol: SymbolInfo;
	target: Place;
	/** The name as its definition writes it: `start`, `:loop`. */
	written: string;
}

/** An edit, as VS Code reports it: the text from `start` to `end` (lines and columns from 1) is now `text`. */
export interface TextEdit {
	start: { line: number; column: number };
	end: { line: number; column: number };
	text: string;
}

export class SymbolIndex {
	private readonly byFile = new Map<string, IndexEntry[]>();
	private readonly keys = new Set<string>();

	/** Adds an entry, once: a macro body's names are reported at each call, a loop's at each iteration. */
	add(entry: IndexEntry): void {
		const key = entryKey(entry);
		if (this.keys.has(key)) return;
		this.keys.add(key);
		const entries = this.byFile.get(entry.place.file) ?? [];
		entries.push(entry);
		this.byFile.set(entry.place.file, entries);
	}

	/** The entries of the name at `line` and `column` in `file`: the cursor can be right after it. */
	at(file: string, line: number, column: number): IndexEntry[] {
		return (this.byFile.get(file) ?? []).filter(({ place }) => place.line === line && place.column <= column && column <= place.endColumn);
	}

	/** The entries, in every file. */
	all(): IndexEntry[] {
		return [...this.byFile.values()].flat();
	}

	/** The entries in `file`. */
	entriesIn(file: string): IndexEntry[] {
		return this.byFile.get(file) ?? [];
	}

	/** The definitions, in `file` or in every file. */
	definitions(file?: string): IndexEntry[] {
		const entries = file === undefined ? [...this.byFile.values()].flat() : (this.byFile.get(file) ?? []);
		return entries.filter((entry) => entry.definition);
	}

	/** The entries, in every file, of the symbols `symbolKey` gives `keys`. */
	entriesOf(keys: ReadonlySet<string>): IndexEntry[] {
		return [...this.byFile.values()].flatMap((entries) => entries.filter((entry) => keys.has(symbolKey(entry))));
	}

	/**
	 * Moves the places in `file`, theirs and their targets', as `edit` moves the text: a name the edit touches is
	 * dropped, as the index can't tell what it is now.
	 */
	shift(file: string, edit: TextEdit): void {
		for (const [entryFile, entries] of this.byFile) {
			const kept: IndexEntry[] = [];
			for (const entry of entries) {
				const place = entryFile === file ? shiftPlace(entry.place, edit) : entry.place;
				if (!place) continue;
				// A target the edit touches stays where it was: the name there may still be what it was.
				const target = entry.target.file === file ? (shiftPlace(entry.target, edit) ?? entry.target) : entry.target;
				kept.push({ ...entry, place, target });
			}
			this.byFile.set(entryFile, kept);
		}
	}
}

/** A char that, typed right next to a name, makes it another name. */
const NAME_CHAR = /[\w.:!@$]/;

/** Compares two positions: negative when `a` comes first. */
const compare = (a: { line: number; column: number }, b: { line: number; column: number }) => a.line - b.line || a.column - b.column;

/**
 * `place` after `edit`, in its file; undefined when the edit touches it: inside it, or right next to it with a char
 * that joins it (typing `x` after `start`, but not a space or a line break).
 */
export function shiftPlace(place: Place, edit: TextEdit): Place | undefined {
	const { start, end, text } = edit;
	const placeStart = { line: place.line, column: place.column };
	const placeEnd = { line: place.line, column: place.endColumn };

	const atEnd = compare(placeEnd, start);
	if (atEnd < 0 || (atEnd === 0 && !NAME_CHAR.test(text.charAt(0)))) return place;
	const atStart = compare(end, placeStart);
	if (atStart > 0 || (atStart === 0 && NAME_CHAR.test(text.charAt(text.length - 1)))) return undefined;

	const lines = text.split("\n");
	const added = lines.length - 1;
	const line = place.line + added - (end.line - start.line);
	if (place.line !== end.line) return { ...place, line };
	// On the edit's last line: its columns move by where the edit's end is now.
	const lastLength = (lines.at(-1) as string).length;
	const delta = (added === 0 ? start.column + lastLength : lastLength + 1) - end.column;
	return { ...place, line, column: place.column + delta, endColumn: place.endColumn + delta };
}

/** A value as the hover writes it: a number in hex and decimal, a relocatable one as its segment and offset. */
export function valueText(value: SymbolValue | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? `$${getHex(value)} (${value})` : String(value);
	if (value instanceof RelocValue) return String(value);
	if (typeof value === "string") return JSON.stringify(value);
	// A constant defined as an expression keeps its tokens.
	if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "object" && item !== null && "type" in item))
		return (value as { raw?: string; value: string }[]).map((token) => token.raw ?? token.value).join(" ");
	const json = JSON.stringify(value) ?? String(value);
	return json.length > 120 ? `${json.slice(0, 119)}…` : json;
}

/** The entries telling different things: a file in two projects is in both indexes. */
export function distinctEntries(entries: IndexEntry[]): IndexEntry[] {
	const byKey = new Map(entries.map((entry) => [entryKey(entry), entry]));
	return [...byKey.values()];
}

function entryKey({ place, definition, symbol, target }: IndexEntry): string {
	return JSON.stringify([place, definition, symbol.kind, symbol.namespace, symbol.name, target, valueText(symbol.value)]);
}

/**
 * What an entry refers to, whatever its value there: its kind, its name and where it's defined. A name in a macro
 * body refers to one symbol at each call, all defined at the same place: they are one for its references.
 */
export function symbolKey({ symbol, target }: IndexEntry): string {
	return JSON.stringify([symbol.kind, symbol.namespace, symbol.name, target]);
}

/**
 * The places of the references, in `indexes`, to what `entries` (the name at the cursor) refer to, and their
 * definitions with `includeDeclaration`: each once, by file, line and column.
 */
export function findReferences(indexes: Iterable<SymbolIndex>, entries: IndexEntry[], includeDeclaration: boolean): Place[] {
	const keys = new Set(entries.map(symbolKey));
	const places = new Map<string, Place>();
	const add = (place: Place) => places.set(JSON.stringify(place), place);
	for (const index of indexes) {
		for (const entry of index.entriesOf(keys)) {
			if (!entry.definition) add(entry.place);
			if (includeDeclaration) add(entry.target);
		}
	}
	if (includeDeclaration) for (const entry of entries) add(entry.target);
	return [...places.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
}

const MAX_SYMBOLS = 5;

/**
 * The hover of a name, in Markdown: each thing it refers to (a name in a macro body can refer to a symbol of each
 * call), its kind, its value, and where it's defined, `relative` writing a file's path.
 */
export function hoverText(entries: IndexEntry[], relative: (file: string) => string): string {
	const blocks = entries.slice(0, MAX_SYMBOLS).map((entry) => {
		const { symbol, definition, target, written } = entry;
		const scope = symbol.namespace && /^(macro|function|proc) /.test(symbol.namespace) ? symbol.namespace : undefined;
		const name = symbol.namespace && !scope ? `${symbol.namespace}::${written}` : written;
		let code: string;
		if (symbol.kind === "macro") code = `.macro ${name}${symbol.parameters?.length ? ` ${symbol.parameters.join(", ")}` : ""}`;
		else if (symbol.kind === "function") code = `.function ${name}(${symbol.parameters?.join(", ") ?? ""})`;
		else {
			const value = valueText(symbol.value);
			const note = symbol.kind === "variable" ? (definition ? " ; its last value" : " ; its value here") : "";
			code = `${symbol.kind} ${name}${value === undefined ? "" : ` = ${value}`}${note}`;
		}
		const lines = ["```tsasm", code, "```"];
		if (scope) lines.push(`In ${scope}.`);
		if (!definition) lines.push(`Defined in \`${relative(target.file)}:${target.line}\`.`);
		return lines.join("\n");
	});
	if (entries.length > MAX_SYMBOLS) blocks.push(`And ${entries.length - MAX_SYMBOLS} more.`);
	return blocks.join("\n\n---\n\n");
}
