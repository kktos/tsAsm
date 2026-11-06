/**
 * semantic.ts
 *
 * * The semantic tokens of a file: each name the assembly resolved, at its place, as what the assembler made of it (a
 *   label, a constant, a variable, a function or its parameter, a macro), its definition marked as one.
 * * The grammar guesses from the text: a label's reference looks like any word, and a local label like `!x` is only
 *   known at a statement's start, as the prefix a file sets with `.option local.prefix` isn't. The assembly knows.
 * * `editors/vscode/package.json` maps each type to the grammar's scope (`semanticTokenScopes`): the colours are its.
 * * Without the vscode module, so it can be tested.
 */

import type { Place } from "./places";
import { nameIn } from "./rename";
import type { IndexEntry } from "./symbol-index";

/** The legend: the types and modifiers, in the order VS Code numbers them. */
export const TOKEN_TYPES = ["label", "variable", "function", "parameter", "macro"] as const;
export const TOKEN_MODIFIERS = ["declaration", "readonly", "local", "anonymous"] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];
export type TokenModifier = (typeof TOKEN_MODIFIERS)[number];

/** A token: its line and column, from 1, its length. */
export interface SemanticToken {
	line: number;
	column: number;
	length: number;
	type: TokenType;
	modifiers: TokenModifier[];
}

/** The tokens of `entries` (the indexes' entries of a file, `text` its text), by line and column, each place once. */
export function semanticTokens(entries: IndexEntry[], text: string): SemanticToken[] {
	const lines = text.split("\n");
	// A function's parameters, by its scope's name: `function DOUBLE` → `X`.
	const parameters = new Map<string, Set<string>>();
	for (const { symbol } of entries) {
		if (symbol.kind !== "function") continue;
		const scope = `function ${symbol.name}`.toUpperCase();
		parameters.set(scope, new Set((symbol.parameters ?? []).map((name) => name.toUpperCase())));
	}

	const tokens = new Map<string, SemanticToken>();
	for (const entry of entries) {
		const { symbol, definition } = entry;
		const modifiers: TokenModifier[] = definition ? ["declaration"] : [];
		let type: TokenType;
		let place: Place | undefined = entry.place;
		switch (symbol.kind) {
			case "anonymous label":
				type = "label";
				modifiers.push("anonymous");
				break;
			case "label":
				type = "label";
				// A local label with its prefix, as the grammar colours it; a global one without its namespace.
				if (symbol.name.includes(".")) modifiers.push("local");
				else place = nameIn(entry.place, entry, lineOf(lines, entry.place.line));
				break;
			case "constant":
				type = "variable";
				modifiers.push("readonly");
				place = nameIn(entry.place, entry, lineOf(lines, entry.place.line));
				break;
			case "variable": {
				const owner = parameters.get(symbol.namespace?.toUpperCase() ?? "");
				type = owner?.has(symbol.name.toUpperCase()) ? "parameter" : "variable";
				place = nameIn(entry.place, entry, lineOf(lines, entry.place.line));
				break;
			}
			default:
				type = symbol.kind;
				place = nameIn(entry.place, entry, lineOf(lines, entry.place.line));
		}
		// A name built by an expression, `.let "pos" + "X"`, isn't written: the grammar colours its string.
		if (!place) continue;
		const key = `${place.line}:${place.column}`;
		if (!tokens.has(key)) tokens.set(key, { line: place.line, column: place.column, length: place.endColumn - place.column, type, modifiers });
	}
	return [...tokens.values()].sort((a, b) => a.line - b.line || a.column - b.column);
}

const lineOf = (lines: string[], line: number) => lines[line - 1]?.replace(/\r$/, "") ?? "";
