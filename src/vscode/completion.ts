/**
 * completion.ts
 *
 * * Completion: at a statement's start, the current CPU's mnemonics, the macros, the directives; in an operand, the
 *   symbols in scope (another namespace's as `gfx::sprite`), the local labels under the current global label, the
 *   system functions and variables; `.option`'s names, `.cpu`'s CPUs.
 * * Signature help on a call: a macro's, a function's, a system function's parameters.
 * * From the text before the cursor and the last good assembly's index. Without the vscode module, so it can be tested.
 */

import { scanBlocks } from "../cli/format/blocks";
import { blankComments } from "../cli/format/comments";
import type { Cpu, Language, SystemFunction } from "./language";
import { type IndexEntry, valueText } from "./symbol-index";

export type CompletionKind =
	| "mnemonic"
	| "directive"
	| "macro"
	| "label"
	| "constant"
	| "variable"
	| "function"
	| "system function"
	| "system variable"
	| "namespace"
	| "option"
	| "cpu";

export interface Completion {
	label: string;
	kind: CompletionKind;
	/** What's inserted: a snippet (`$1`) when `snippet`. */
	insert: string;
	snippet?: boolean;
	detail?: string;
	documentation?: string;
	/** The columns it replaces on the cursor's line, from 1, `end` after the last: what's typed of it. */
	start: number;
	end: number;
	/** Shows the call's parameters once inserted. */
	parameterHints?: boolean;
}

export interface SourceContext {
	/** The file's text, and the cursor's line and column, from 1. */
	text: string;
	line: number;
	column: number;
	language: Language;
	/** The CPU of the file's projects (`input.cpu`): undefined for a file in no project. */
	cpu?: string;
	/** The definitions of the file's projects, from their last good assembly. */
	definitions: IndexEntry[];
	/** The namespaces of the projects' files, as written. */
	namespaces: string[];
	/** The file's path, for its local labels. */
	file: string;
}

const IDENTIFIER = /^[A-Za-z_]\w*$/;
const SCOPES = /^(proc|macro|function) /;
const CPU_DIRECTIVES = new Set(["CPU", "SETCPU", "PROCESSOR"]);

/** The cursor's line, its code (comments made spaces) and its statement before the cursor. */
export function lineBefore(context: SourceContext) {
	const lineText = context.text.split("\n")[context.line - 1]?.replace(/\r$/, "") ?? "";
	const before = lineText.slice(0, context.column - 1);
	const code = blankComments(lineText).slice(0, context.column - 1);
	// In a comment: its chars are spaces in `code`.
	const inComment = code !== before;
	const blanked = code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (string) => " ".repeat(string.length));
	const inString = /["']/.test(blanked);
	const start = Math.max(blanked.lastIndexOf("{"), blanked.lastIndexOf("}")) + 1;
	return { before, code: blanked, inComment, inString, statement: blanked.slice(start) };
}

/** The words of a statement before what's being typed, its label left out: the first is its mnemonic, directive or macro. */
export function statementWords(statement: string, typed: string, isHead: (word: string) => boolean): { words: string[]; atHead: boolean } {
	const head = statement.slice(0, statement.length - typed.length);
	const words = head.trim().split(/\s+/).filter(Boolean);
	// `start:`, `:loop`, `:`, or a word that is no instruction, directive or macro, then a space: a label.
	const [first] = words;
	if (first !== undefined && (first.endsWith(":") || /^[:@!?~]/.test(first) || (!isHead(first) && !first.startsWith(".") && /\s$/.test(head)))) words.shift();
	return { words, atHead: words.length === 0 };
}

/** The CPU at the cursor: the last `.cpu` above it, else the project's; undefined (every CPU) for a file in no project. */
export function currentCpu(context: SourceContext): Cpu | undefined {
	const lines = blankComments(context.text)
		.split("\n")
		.slice(0, context.line - 1);
	const find = (name: string) => context.language.cpus.find(({ names }) => names.includes(name.replace(/^["']|["']$/g, "").toUpperCase()));
	for (const line of lines.reverse()) {
		const match = /(?:^|\s)\.(?:cpu|setcpu|processor)\s+(\S+)/i.exec(line);
		const cpu = match && find(match[1] as string);
		if (cpu) return cpu;
	}
	return context.cpu === undefined ? undefined : find(context.cpu);
}

/** The case to write a name in: as typed (`LD` → `LDA`), else as most of `samples`, else lower case. */
function caseOf(typed: string, samples: string[]): (name: string) => string {
	const lower = (name: string) => name.toLowerCase();
	const upper = (name: string) => name.toUpperCase();
	const letters = typed.replace(/[^A-Za-z]/g, "");
	if (letters) return letters === letters.toUpperCase() ? upper : lower;
	const uppers = samples.filter((word) => /[A-Z]/.test(word) && word === word.toUpperCase()).length;
	return uppers > samples.length - uppers ? upper : lower;
}

/** The first words of the file's statements, a label left out: to tell its case. */
function heads(text: string, keep: (word: string) => boolean): string[] {
	return blankComments(text)
		.split("\n")
		.map((line) => line.trim().split(/\s+/))
		.map((words) => (words[0]?.endsWith(":") ? words[1] : keep(words[0] ?? "") ? words[0] : words[1]) ?? "")
		.filter(keep);
}

/** The completions at the cursor. */
export function complete(context: SourceContext): Completion[] {
	const { before, inComment, inString, statement } = lineBefore(context);
	if (inComment || inString) return [];
	const { language } = context;
	const cpu = currentCpu(context);
	const cpus = cpu ? [cpu] : language.cpus;
	const mnemonics = new Set(cpus.flatMap(({ mnemonics }) => mnemonics));
	const macros = context.definitions.filter(({ symbol }) => symbol.kind === "macro");
	const macroNames = new Set(macros.map(({ symbol }) => symbol.name.toUpperCase()));
	const isHead = (word: string) => mnemonics.has(word.toUpperCase()) || macroNames.has(word.toUpperCase());

	const typed = /(?:[A-Za-z_]\w*::)?[.:@!?~]?\w*$/.exec(before)?.[0] ?? "";
	const { words, atHead } = statementWords(statement, typed, isHead);
	const end = context.column;
	const at = (text: string) => ({ start: end - text.length, end });

	if (atHead) {
		if (typed.startsWith(".")) {
			const directives = [...language.directives, ...cpus.flatMap(({ directives }) => directives)];
			const write = caseOf(
				typed.slice(1),
				heads(context.text, (word) => word.startsWith(".")).map((word) => word.slice(1)),
			);
			return [...new Set(directives)].map((name) => ({ label: `.${write(name)}`, kind: "directive", insert: `.${write(name)}`, ...at(typed) }));
		}
		const write = caseOf(
			typed,
			heads(context.text, (word) => mnemonics.has(word.toUpperCase())),
		);
		const items: Completion[] = [...mnemonics].map((name) => ({ label: write(name), kind: "mnemonic", insert: write(name), ...at(typed) }));
		for (const { symbol, written } of distinct(macros)) {
			items.push({ label: written, kind: "macro", insert: written, detail: symbol.parameters?.join(", ") ?? "", ...at(typed) });
		}
		return items;
	}

	// An option's name has dots: `local.prefix`.
	const option = /[\w.]*$/.exec(before)?.[0] ?? "";
	const optionWords = statementWords(statement, option, isHead).words;
	if (optionWords.length === 1 && optionWords[0]?.toUpperCase() === ".OPTION")
		return language.options.map(({ name, values }) => ({ label: name, kind: "option", insert: name, detail: values, ...at(option) }));
	const directive = words[0]?.startsWith(".") ? words[0].slice(1).toUpperCase() : undefined;
	if (directive && CPU_DIRECTIVES.has(directive) && words.length === 1)
		return language.cpus.map(({ name }) => ({ label: name, kind: "cpu", insert: name, ...at(typed) }));

	if (typed.startsWith(".")) return systemCompletions(language, at(typed), caseOf(typed.slice(1), []));
	const qualified = /^([A-Za-z_]\w*)::/.exec(typed);
	if (qualified) {
		const namespace = (qualified[1] as string).toUpperCase();
		const symbols = distinct(context.definitions.filter(({ symbol }) => symbol.namespace?.toUpperCase() === namespace && isSymbol(symbol.kind)));
		return symbols.map((entry) => symbolCompletion(entry, nameOf(entry), at(typed.slice(qualified[0].length))));
	}
	if (/^[:@!?~]/.test(typed)) return localLabels(context, at(typed));
	return symbolsInScope(context, at(typed));
}

/** The kinds of what an operand names. */
const isSymbol = (kind: string) => kind === "label" || kind === "constant" || kind === "variable" || kind === "function";

/** A name as its definition writes it, else as the assembler knows it (`.let "pos" + "X"` defines `POSX`). */
const nameOf = ({ written, symbol }: IndexEntry) => (IDENTIFIER.test(written) ? written : (symbol.name.split(/::|\./).at(-1) ?? symbol.name));

/** Each definition once: a file in two projects, a macro body's symbol at each call. */
function distinct(entries: IndexEntry[]): IndexEntry[] {
	const byKey = new Map(entries.map((entry) => [JSON.stringify([entry.symbol.kind, entry.symbol.namespace, entry.symbol.name]), entry]));
	return [...byKey.values()];
}

function symbolCompletion(entry: IndexEntry, label: string, range: { start: number; end: number }): Completion {
	const { symbol } = entry;
	if (symbol.kind === "function") {
		const parameters = symbol.parameters ?? [];
		return {
			label,
			kind: "function",
			insert: `${label}(${parameters.length > 0 ? "$1" : ""})`,
			snippet: true,
			detail: `(${parameters.join(", ")})`,
			parameterHints: parameters.length > 0,
			...range,
		};
	}
	const value = valueText(symbol.value);
	return { label, kind: symbol.kind as CompletionKind, insert: label, detail: value === undefined ? symbol.kind : `${symbol.kind} = ${value}`, ...range };
}

/** The scopes around the cursor, in upper case: its namespace, and the procs, macros and functions it's in (`PROC INIT`). */
function scopesAt(context: SourceContext): { namespace?: string; scopes: Set<string> } {
	const scopes = new Set<string>();
	let namespace: string | undefined;
	for (const block of scanBlocks(context.text)) {
		const inside =
			(block.start.line < context.line || (block.start.line === context.line && block.start.column < context.column)) &&
			(block.end.line > context.line || (block.end.line === context.line && block.end.column >= context.column));
		if (!inside || !block.name) continue;
		if (block.kind === "namespace") namespace = block.name.toUpperCase();
		else if (block.kind === "proc" || block.kind === "macro" || block.kind === "function") scopes.add(`${block.kind} ${block.name}`.toUpperCase());
	}
	return namespace === undefined ? { scopes } : { namespace, scopes };
}

/** The symbols reachable by their bare name at the cursor, the other namespaces' qualified, and the namespaces. */
function symbolsInScope(context: SourceContext, range: { start: number; end: number }): Completion[] {
	const { namespace, scopes } = scopesAt(context);
	const items: Completion[] = [];
	const spelled = new Map(context.namespaces.map((name) => [name.toUpperCase(), name]));
	for (const entry of distinct(context.definitions)) {
		const { symbol } = entry;
		if (!isSymbol(symbol.kind) || symbol.name.includes(".") || symbol.name.includes("::")) continue;
		const owner = symbol.namespace;
		if (owner === undefined || owner.toUpperCase() === namespace) items.push(symbolCompletion(entry, nameOf(entry), range));
		else if (SCOPES.test(owner)) {
			if (scopes.has(owner.toUpperCase())) items.push(symbolCompletion(entry, nameOf(entry), range));
		} else items.push(symbolCompletion(entry, `${spelled.get(owner.toUpperCase()) ?? owner}::${nameOf(entry)}`, range));
	}
	for (const name of new Set(spelled.values())) items.push({ label: `${name}::`, kind: "namespace", insert: `${name}::`, ...range });
	return items;
}

/** The local labels under the global label before the cursor, in its file. */
function localLabels(context: SourceContext, range: { start: number; end: number }): Completion[] {
	const inFile = context.definitions.filter(({ target, symbol }) => target.file === context.file && symbol.kind === "label");
	const globals = inFile.filter(({ symbol, target }) => !symbol.name.includes(".") && target.line <= context.line);
	const global = globals.sort((a, b) => a.target.line - b.target.line).at(-1);
	if (!global) return [];
	const prefix = `${global.symbol.name}.`;
	return distinct(inFile.filter(({ symbol }) => symbol.name.startsWith(prefix))).map((entry) => ({
		label: entry.written,
		kind: "label",
		insert: entry.written,
		detail: `label = ${valueText(entry.symbol.value)}`,
		...range,
	}));
}

/** The system functions and variables, after a dot. */
function systemCompletions(language: Language, range: { start: number; end: number }, write: (name: string) => string): Completion[] {
	const functions = language.functions.map((fn): Completion => ({
		label: `.${write(fn.name)}`,
		kind: "system function",
		insert: `.${write(fn.name)}(${fn.maxArgs > 0 ? "$1" : ""})`,
		snippet: true,
		detail: systemSignature(fn, write).label,
		documentation: fn.description,
		parameterHints: fn.maxArgs > 0,
		...range,
	}));
	const variables = language.variables.map(({ name, description }): Completion => ({
		label: `.${write(name)}`,
		kind: "system variable",
		insert: `.${write(name)}`,
		documentation: description,
		...range,
	}));
	return [...functions, ...variables];
}

export interface Signature {
	label: string;
	/** Each parameter's offsets in `label`, the end after its last char. */
	parameters: [number, number][];
	/** The parameter the cursor is at. */
	active: number;
	documentation?: string;
}

/** A signature from its name and its parameters' texts, `open` and `close` around them. */
function signature(name: string, parameters: string[], open: string, close: string): Omit<Signature, "active"> {
	let label = `${name}${open}`;
	const offsets: [number, number][] = [];
	parameters.forEach((parameter, index) => {
		if (index > 0) label += ", ";
		offsets.push([label.length, label.length + parameter.length]);
		label += parameter;
	});
	return { label: label + close, parameters: offsets };
}

/** `.pad(value, width, fill?)`: an optional parameter has a `?`, a repeated one `…`. */
function systemSignature(fn: SystemFunction, write: (name: string) => string = (name) => name.toLowerCase()): Omit<Signature, "active"> {
	const texts = fn.parameters.map((name, index) => {
		if (index === fn.parameters.length - 1 && fn.maxArgs === Number.POSITIVE_INFINITY) return `${name}…`;
		return index >= fn.minArgs ? `${name}?` : name;
	});
	return signature(`.${write(fn.name)}`, texts, "(", ")");
}

/** The signature of the call the cursor is in, and its parameter there: a function's in `( )`, a macro's in its operands. */
export function signatureAt(context: SourceContext): Signature | undefined {
	const { inComment, inString, statement } = lineBefore(context);
	if (inComment || inString) return undefined;
	const named = (kind: string, name: string) =>
		context.definitions.find(({ symbol }) => symbol.kind === kind && symbol.name.split("::").at(-1)?.toUpperCase() === name.toUpperCase());

	// The innermost `(` not closed, and the commas after it at its depth.
	const opens: { at: number; commas: number }[] = [];
	let brackets = 0;
	for (let index = 0; index < statement.length; index++) {
		const char = statement[index];
		if (char === "(") opens.push({ at: index, commas: 0 });
		else if (char === ")") opens.pop();
		else if (char === "[") brackets++;
		else if (char === "]") brackets--;
		else if (char === "," && brackets === 0 && opens.length > 0) (opens.at(-1) as { commas: number }).commas++;
	}
	const call = opens.at(-1);
	if (call) {
		const name = /(\.?[A-Za-z_]\w*)(?:::([A-Za-z_]\w*))?$/.exec(statement.slice(0, call.at));
		if (name) {
			const short = (name[2] ?? name[1]) as string;
			if (short.startsWith(".")) {
				const fn = context.language.functions.find(({ name: each }) => each === short.slice(1).toUpperCase());
				if (fn) return { ...systemSignature(fn), active: Math.min(call.commas, fn.parameters.length - 1), documentation: fn.description };
			}
			const fn = named("function", short);
			if (fn) return withActive(signature(fn.written, [...(fn.symbol.parameters ?? [])], "(", ")"), call.commas);
			const macro = named("macro", short);
			if (macro) return withActive(signature(macro.written, [...(macro.symbol.parameters ?? [])], "(", ")"), call.commas);
		}
	}

	// A macro call's operands, `clear $10, 2`.
	const cpu = currentCpu(context);
	const mnemonics = new Set((cpu ? [cpu] : context.language.cpus).flatMap(({ mnemonics }) => mnemonics));
	const isHead = (word: string) => mnemonics.has(word.toUpperCase()) || named("macro", word) !== undefined;
	const words = statement.trim().split(/\s+/);
	const first = words[0]?.endsWith(":") || /^[:@!?~]/.test(words[0] ?? "") || (words[0] && !isHead(words[0]) && words.length > 1) ? 1 : 0;
	const head = words[first];
	if (!head || !/\s/.test(statement.slice(statement.indexOf(head) + head.length))) return undefined;
	const macro = named("macro", head);
	if (!macro || mnemonics.has(head.toUpperCase())) return undefined;
	const operands = statement.slice(statement.indexOf(head) + head.length);
	let depth = 0;
	let commas = 0;
	for (const char of operands) {
		if (char === "(" || char === "[") depth++;
		else if (char === ")" || char === "]") depth--;
		else if (char === "," && depth === 0) commas++;
	}
	return withActive(signature(`${macro.written} `, [...(macro.symbol.parameters ?? [])], "", ""), commas);
}

/** The signature with its parameter at `index`: the last for a rest parameter, `...args`. */
function withActive(base: Omit<Signature, "active">, index: number): Signature {
	const count = base.parameters.length;
	const last = base.parameters.at(-1);
	const rest = last !== undefined && base.label.slice(last[0], last[0] + 3) === "...";
	return { ...base, active: rest ? Math.min(index, count - 1) : index };
}
