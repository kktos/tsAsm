/**
 * outline.ts
 *
 * * A file's outline: its blocks (`.macro`, `.proc`, `.function`, `.namespace`) from its text, the `.segment`
 *   selections as markers, and in them the symbols the last assembly defined there, a local label under its global one.
 * * The workspace's symbols, for Cmd+T.
 * * Without the vscode module, so it can be tested.
 */

import type { Block, Position } from "../format/blocks";
import type { Place } from "./places";
import { type IndexEntry, valueText } from "./symbol-index";

export type OutlineKind = "macro" | "proc" | "function" | "namespace" | "segment" | "label" | "constant" | "variable";

export interface Range {
	start: Position;
	/** After its last char. */
	end: Position;
}

export interface OutlineNode {
	name: string;
	/** What VS Code writes after the name: a value, a macro's or a function's parameters. */
	detail: string;
	kind: OutlineKind;
	range: Range;
	/** Its name: within `range`. */
	selection: Range;
	children: OutlineNode[];
}

const CONTAINERS = new Set(["macro", "proc", "function", "namespace"]);

const compare = (a: Position, b: Position) => a.line - b.line || a.column - b.column;
const placeRange = ({ line, column, endColumn }: Place): Range => ({ start: { line, column }, end: { line, column: endColumn } });
const within = (range: Range, position: Position) => compare(range.start, position) <= 0 && compare(position, range.end) < 0;

/** What VS Code writes after a symbol's name. */
function detail({ symbol }: IndexEntry): string {
	if (symbol.kind === "macro") return symbol.parameters?.join(", ") ?? "";
	if (symbol.kind === "function") return `(${symbol.parameters?.join(", ") ?? ""})`;
	return valueText(symbol.value) ?? "";
}

/** A local label, `START.LOOP`: under its global label. */
const isLocalLabel = ({ symbol }: IndexEntry) => symbol.kind === "label" && symbol.name.includes(".");

/**
 * The outline of a file: `blocks` from its text, `definitions` the index's definitions in it. A symbol is in the
 * innermost block around it; a block's own symbol (a proc's label, a macro, a function) gives the block its detail.
 */
export function buildOutline(blocks: Block[], definitions: IndexEntry[]): OutlineNode[] {
	const nodes: OutlineNode[] = [];
	const containers = new Set<OutlineNode>();
	const used = new Set<IndexEntry>();
	// The labels by their entries, for their local labels.
	const labels = new Map<OutlineNode, IndexEntry>();

	for (const block of blocks) {
		if (!CONTAINERS.has(block.kind) && block.kind !== "segment") continue;
		const selection = block.nameStart && block.nameEnd ? { start: block.nameStart, end: block.nameEnd } : { start: block.start, end: block.start };
		const own = definitions.find(
			(entry) => !used.has(entry) && entry.place.line === selection.start.line && within(placeRange(entry.place), selection.start),
		);
		if (own) used.add(own);
		const node: OutlineNode = {
			name: block.name ?? `.${block.kind}`,
			detail: own ? detail(own) : "",
			kind: block.kind as OutlineKind,
			range: { start: block.start, end: block.end },
			selection,
			children: [],
		};
		nodes.push(node);
		if (block.kind !== "segment") containers.add(node);
	}

	// A file in two projects has its definitions in both indexes.
	const seen = new Set<string>();
	for (const entry of definitions) {
		if (used.has(entry) || entry.symbol.kind === "anonymous label" || entry.symbol.kind === "macro") continue;
		const key = JSON.stringify([entry.place, entry.symbol.kind, entry.symbol.name]);
		if (seen.has(key)) continue;
		seen.add(key);
		const kind: OutlineKind = entry.symbol.kind === "function" ? "function" : entry.symbol.kind;
		const range = placeRange(entry.place);
		const node = { name: entry.written, detail: detail(entry), kind, range, selection: range, children: [] };
		nodes.push(node);
		if (kind === "label") labels.set(node, entry);
	}

	// Outer first: a block before what it holds, a longer one before a shorter one starting with it.
	nodes.sort((a, b) => compare(a.range.start, b.range.start) || compare(b.range.end, a.range.end));
	const roots: OutlineNode[] = [];
	const stack: OutlineNode[] = [];
	for (const node of nodes) {
		while (stack.length > 0 && !within((stack.at(-1) as OutlineNode).range, node.range.start)) stack.pop();
		(stack.at(-1)?.children ?? roots).push(node);
		if (containers.has(node)) stack.push(node);
	}
	nestLocalLabels(roots, labels);
	return roots;
}

/** Moves each local label under the global label before it, in the same block, which then spans them. */
function nestLocalLabels(nodes: OutlineNode[], labels: Map<OutlineNode, IndexEntry>): void {
	let global: { node: OutlineNode; name: string } | undefined;
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index] as OutlineNode;
		nestLocalLabels(node.children, labels);
		const entry = labels.get(node);
		if (!entry) continue;
		if (!isLocalLabel(entry)) {
			global = { node, name: entry.symbol.name };
			continue;
		}
		if (!global || !entry.symbol.name.startsWith(`${global.name}.`)) continue;
		global.node.children.push(node);
		if (compare(global.node.range.end, node.range.end) < 0) global.node.range = { start: global.node.range.start, end: node.range.end };
		nodes.splice(index--, 1);
	}
}

export interface WorkspaceSymbol {
	name: string;
	kind: OutlineKind;
	/** Its namespace, its proc, `macro m`. */
	container?: string;
	place: Place;
}

/**
 * The workspace's symbols matching `query`, its chars in order, in any case: every symbol defined, but local and
 * anonymous labels, whose names repeat everywhere, and the namespaces, from the files' text.
 */
export function workspaceSymbols(definitions: IndexEntry[], namespaces: { name: string; place: Place }[], query: string): WorkspaceSymbol[] {
	const symbols: WorkspaceSymbol[] = [];
	const seen = new Set<string>();
	const add = (symbol: WorkspaceSymbol) => {
		const key = JSON.stringify([symbol.place, symbol.kind]);
		if (seen.has(key) || !matches(symbol.name, query)) return;
		seen.add(key);
		symbols.push(symbol);
	};
	for (const entry of definitions) {
		if (!entry.definition || entry.symbol.kind === "anonymous label" || isLocalLabel(entry)) continue;
		const symbol: WorkspaceSymbol = { name: entry.written, kind: entry.symbol.kind, place: entry.place };
		if (entry.symbol.namespace) symbol.container = entry.symbol.namespace;
		add(symbol);
	}
	for (const { name, place } of namespaces) add({ name, kind: "namespace", place });
	return symbols;
}

/** Whether `query`'s chars are in `name`, in order, in any case: `clrs` matches `clearScreen`. */
function matches(name: string, query: string): boolean {
	const lower = name.toLowerCase();
	let at = 0;
	for (const char of query.toLowerCase()) {
		at = lower.indexOf(char, at) + 1;
		if (at === 0) return false;
	}
	return true;
}
