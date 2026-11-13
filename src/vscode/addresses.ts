/**
 * addresses.ts
 *
 * * The address of each line, for the inlay hints: from the statements' bytes the assembly reports (`onEmit`) and the
 *   labels' values.
 * * A line assembled several times (a loop's body, a macro's) gives its first address and how many times; a macro call
 *   and an `.include` give the first address of what they assembled, a loop's header that of its body.
 * * Without the vscode module, so it can be tested.
 */

import { RelocValue } from "../assembler/reloc-value.class";
import type { Block } from "../cli/format/blocks";
import { getAddressHex, getHex } from "../utils/hex.util";
import type { Place } from "./places";
import type { IndexEntry } from "./symbol-index";

/** A statement's bytes, located: `chain` the macro calls and `.include` directives that led to it, innermost first. */
export interface LocatedEmission {
	place: Place;
	chain: Place[];
	address: number | RelocValue;
	bytes: number[];
}

/** A line's address: at `place`, its statement, `order` when it was first assembled. */
export interface AddressHint {
	place: Place;
	address: string;
	/** How many times it was assembled. */
	runs: number;
	/** Its bytes, in all its runs. */
	size: number;
	/** Its bytes, in its first run, when it's a statement (not a macro call or an `.include`). */
	bytes?: number[];
	order: number;
}

/** An address as the hints write it: `$1000`, `CODE+$0012`. */
export function addressText(address: number | RelocValue): string {
	return address instanceof RelocValue ? String(address) : `$${getAddressHex(address)}`;
}

const lineKey = ({ file, line }: Place) => `${file}:${line}`;

/**
 * The hints of the lines `emissions` and `labels` (the labels' definitions) are on: a line with a statement's bytes,
 * a macro call or an `.include` that led to some, a label alone.
 */
export function addressHints(emissions: LocatedEmission[], labels: IndexEntry[]): AddressHint[] {
	// Each line's runs: what the emissions there, or under it, went through below it.
	const lines = new Map<string, { place: Place; runs: { path: string; address: number | RelocValue; bytes: number[] }[]; order: number }>();
	emissions.forEach(({ place, chain, address, bytes }, order) => {
		const steps = [place, ...chain];
		steps.forEach((step, depth) => {
			const key = lineKey(step);
			const line = lines.get(key) ?? { place: step, runs: [], order };
			lines.set(key, line);
			line.runs.push({ path: JSON.stringify(steps.slice(0, depth).map(lineKey)), address, bytes });
		});
	});

	const hints: AddressHint[] = [];
	for (const { place, runs, order } of lines.values()) {
		const [first] = runs as [(typeof runs)[number]];
		// A run starts where the first one did: the same statement, reached the same way.
		const count = runs.filter(({ path }) => path === first.path).length;
		const size = runs.reduce((total, { bytes }) => total + bytes.length, 0);
		const hint: AddressHint = { place, address: addressText(first.address), runs: count, size, order };
		if (first.path === "[]") hint.bytes = first.bytes;
		hints.push(hint);
	}

	const hinted = new Set(hints.map(({ place }) => lineKey(place)));
	for (const { symbol, target } of labels) {
		if ((symbol.kind !== "label" && symbol.kind !== "anonymous label") || hinted.has(lineKey(target))) continue;
		if (typeof symbol.value !== "number" && !(symbol.value instanceof RelocValue)) continue;
		hinted.add(lineKey(target));
		hints.push({ place: target, address: addressText(symbol.value), runs: 1, size: 0, order: Number.POSITIVE_INFINITY });
	}
	return hints;
}

/** A hint as shown at the end of its line, and its tooltip. */
export interface LineHint {
	line: number;
	text: string;
	tooltip: string;
}

const MAX_BYTES = 16;

/**
 * The hints of a file, `hints` its lines' and `blocks` its blocks: a loop's header gets the first address of its
 * body, and its bytes in all. A line once, though the file is in two projects.
 */
export function lineHints(hints: AddressHint[], blocks: Block[]): LineHint[] {
	const byLine = new Map<number, AddressHint>();
	for (const hint of hints) if (!byLine.has(hint.place.line)) byLine.set(hint.place.line, hint);

	const result: LineHint[] = [];
	for (const [line, { address, runs, size, bytes }] of byLine) {
		const times = runs > 1 ? ` ×${runs}` : "";
		let tooltip: string;
		if (bytes && runs === 1) tooltip = bytes.length > MAX_BYTES ? `${hex(bytes.slice(0, MAX_BYTES))} … (${bytes.length} bytes)` : hex(bytes);
		else if (size === 0) tooltip = "A label's address.";
		else tooltip = `${size} byte${size === 1 ? "" : "s"}${runs > 1 ? ` in ${runs} runs` : ""}.`;
		result.push({ line, text: `${address}${times}`, tooltip });
	}

	for (const block of blocks) {
		if (block.kind !== "loop" || byLine.has(block.start.line)) continue;
		// Its body's lines, not the loops in it, whose hints are their bodies'.
		const inside = [...byLine.entries()].filter(([line]) => line > block.start.line && line < block.end.line + (block.closed ? 0 : 1));
		const first = inside.map(([, hint]) => hint).sort((a, b) => a.order - b.order)[0];
		if (!first || first.order === Number.POSITIVE_INFINITY) continue;
		const size = inside.reduce((total, [, hint]) => total + hint.size, 0);
		result.push({ line: block.start.line, text: first.address, tooltip: `${size} byte${size === 1 ? "" : "s"} in all.` });
	}
	return result.sort((a, b) => a.line - b.line);
}

const hex = (bytes: number[]) => bytes.map((byte) => getHex(byte, 2)).join(" ");
