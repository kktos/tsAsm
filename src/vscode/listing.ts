/**
 * listing.ts
 *
 * * A project's listing, as the CLI writes it with `passes.pass2`: from the assembler's `onListing`, each line tied
 *   to the statement that listed it, for the command showing the listing at the cursor's line.
 * * Without the vscode module, so it can be tested.
 */

import type { Place } from "./places";

/** A line of the listing: `place` the statement that listed it, `chain` the macro calls and `.include`s that led to it. */
export interface ListingLine {
	text: string;
	place?: Place;
	chain: Place[];
}

/**
 * The listing's line (from 0) for line `line` of `file`: the first it listed, else the first a macro call or an
 * `.include` there led to, `exact`; else, for a line that listed nothing (a comment, a blank line), the first of the
 * closest line above that did, not `exact`.
 */
export function listingLineOf(lines: ListingLine[], file: string, line: number): { index: number; exact: boolean } | undefined {
	const on = (place: Place | undefined) => place?.file === file && place.line === line;
	let index = lines.findIndex(({ place }) => on(place));
	if (index < 0) index = lines.findIndex(({ chain }) => chain.some(on));
	if (index >= 0) return { index, exact: true };

	// The closest line above in the file, as itself or through a call.
	let best: { index: number; line: number } | undefined;
	lines.forEach(({ place, chain }, at) => {
		for (const step of [place, ...chain]) {
			if (step?.file !== file || step.line >= line) continue;
			if (!best || step.line > best.line) best = { index: at, line: step.line };
		}
	});
	return best && { index: best.index, exact: false };
}

/** The listing's text. */
export const listingText = (lines: ListingLine[]) => lines.map(({ text }) => text.replace(/\s+$/, "")).join("\n");
