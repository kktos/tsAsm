/**
 * unread.ts
 *
 * * The code the assembly didn't read, faded in the editor: an `.if` branch not taken, a macro or a function never
 *   called, a `.repeat 0`'s body. From the statements pass 2 read (the assembler's `onStatement`) and the file's blocks.
 * * Without the vscode module, so it can be tested.
 */

import type { Block } from "./blocks";
import { blankComments } from "./links";
import type { Place } from "./places";

/**
 * The runs of lines (from 1, `end` included) of `text` the assembly didn't read, `read` the lines its statements start
 * on. A block whose directive was read has its `.end`, `}`, `.elseif` and `.else` read too, and a `.define`'s or a
 * `.hex`'s text, and a `.struct`'s fields, which its directive reads; a run goes over the comments and blank lines between its code lines, not around them.
 */
export function unreadRuns(text: string, read: ReadonlySet<number>, blocks: Block[]): { start: number; end: number }[] {
	const lines = blankComments(text).split("\n");
	const known = new Set(read);
	// Outer blocks first: a braced `} .else {` starts where the branch before it ends.
	for (const block of [...blocks].sort((a, b) => a.start.line - b.start.line || a.start.column - b.start.column)) {
		if (!known.has(block.start.line)) continue;
		const end = block.closed ? block.end.line : lines.length;
		if (block.kind === "struct" || block.kind === "define" || block.kind === "hex") for (let line = block.start.line; line <= end; line++) known.add(line);
		else if (block.closed) known.add(block.end.line);
		for (const branch of block.branches ?? []) known.add(branch.line);
	}

	const runs: { start: number; end: number }[] = [];
	let run: { start: number; end: number } | undefined;
	lines.forEach((code, at) => {
		const line = at + 1;
		if (!code.trim()) return;
		if (known.has(line)) {
			run = undefined;
			return;
		}
		if (run) run.end = line;
		else {
			run = { start: line, end: line };
			runs.push(run);
		}
	});
	return runs;
}

/**
 * The runs of lines no project read, `projects` the lines each project that reads the file didn't: a branch one
 * build takes stays shown. Each run up to the end of its last line.
 */
export function commonRuns(projects: Place[][]): { start: number; end: number; endColumn: number }[] {
	const [first, ...others] = projects;
	if (!first) return [];
	const lines = others.map((places) => new Set(places.map(({ line }) => line)));
	const common = first.filter(({ line }) => lines.every((set) => set.has(line))).sort((a, b) => a.line - b.line);
	const runs: { start: number; end: number; endColumn: number }[] = [];
	for (const { line, endColumn } of common) {
		const last = runs.at(-1);
		if (last && last.end === line - 1) Object.assign(last, { end: line, endColumn });
		else runs.push({ start: line, end: line, endColumn });
	}
	return runs;
}
