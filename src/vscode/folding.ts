/**
 * folding.ts
 *
 * * A file's folding ranges: its blocks (`.macro`, `.proc`, `.if` and each of its branches, `.repeat`, `{ }`, raw
 *   blocks), the code under each global label up to the next, the runs of comment lines, and `; region` … `; endregion`.
 * * VS Code uses them instead of the indentation, which a block written flat doesn't have.
 * * Without the vscode module, so it can be tested.
 */

import type { Block } from "../format/blocks";
import { blankComments } from "../format/comments";

/** Lines from 1: `start` stays shown, the lines after it up to `end` are hidden. */
export interface Fold {
	start: number;
	end: number;
	kind?: "comment" | "region";
}

/** The blocks that hold code, which a label's code doesn't run past. */
const CONTAINERS = new Set(["macro", "proc", "function", "namespace"]);

const REGION = /^\s*(?:;|\/\/)\s*#?region\b/i;
const END_REGION = /^\s*(?:;|\/\/)\s*#?endregion\b/i;

/**
 * The folds of `source`: `blocks` its blocks, `labels` the lines of its global labels (from the last good assembly).
 * A block's closing line (`.end`, `}`) stays shown; a fold of one line isn't one.
 */
export function foldingRanges(source: string, blocks: Block[], labels: number[]): Fold[] {
	const lines = source.split("\n");
	const code = blankComments(source).split("\n");
	const folds: Fold[] = [];
	const add = (fold: Fold) => fold.end > fold.start && folds.push(fold);

	for (const block of blocks) {
		if (block.kind === "segment") continue;
		// Up to the line before its `.end` or `}`, or to the file's end without one.
		const last = block.closed ? block.end.line - 1 : block.end.line;
		const starts = [block.start.line, ...(block.branches ?? []).map(({ line }) => line)];
		starts.forEach((start, index) => add({ start, end: index + 1 < starts.length ? (starts[index + 1] as number) - 1 : last }));
	}

	// A routine: from its label up to the next one, the next block holding code, or the end of the block it's in, its
	// trailing blank and comment lines left out (a comment there is the next routine's).
	const blockStarts = new Set(blocks.map(({ start }) => start.line));
	const sorted = [...new Set(labels)].filter((line) => !blockStarts.has(line)).sort((a, b) => a - b);
	for (const [index, start] of sorted.entries()) {
		let end = (sorted[index + 1] ?? lines.length + 1) - 1;
		for (const block of blocks) {
			if (block.start.line > start && CONTAINERS.has(block.kind)) end = Math.min(end, block.start.line - 1);
			// In a block, up to the line before its end, or its next branch.
			else if (block.start.line < start && start <= block.end.line) {
				if (block.closed) end = Math.min(end, block.end.line - 1);
				for (const { line } of block.branches ?? []) if (line > start) end = Math.min(end, line - 1);
			}
		}
		while (end > start && (code[end - 1] ?? "").trim() === "") end--;
		add({ start, end });
	}

	// Runs of comment lines, a region's markers left out of them.
	let run: number | undefined;
	const regions: number[] = [];
	for (let line = 1; line <= lines.length + 1; line++) {
		const text = lines[line - 1];
		const isComment = text !== undefined && text.trim() !== "" && (code[line - 1] ?? "").trim() === "";
		const isRegion = text !== undefined && REGION.test(text);
		const isEndRegion = text !== undefined && END_REGION.test(text);
		if (isRegion) regions.push(line);
		else if (isEndRegion) {
			const start = regions.pop();
			if (start !== undefined) add({ start, end: line, kind: "region" });
		}
		if (isComment && !isRegion && !isEndRegion) run ??= line;
		else if (run !== undefined) {
			add({ start: run, end: line - 1, kind: "comment" });
			run = undefined;
		}
	}
	return folds.sort((a, b) => a.start - b.start || b.end - a.end);
}
