/**
 * comments.ts
 *
 * * A source's comments blanked out, for the readers of its text: the blocks, the links, the formatter.
 */

/**
 * The source with its comments made spaces, its line breaks kept: what a comment says isn't read, and the offsets stay.
 * A line comment starts with `commentChar` or `//`.
 */
export function blankComments(source: string, commentChar = ";"): string {
	let text = "";
	let quote: string | undefined;
	for (let i = 0; i < source.length; i++) {
		const char = source[i] as string;
		if (quote) {
			if (char === "\\" && source[i + 1] !== "\n") {
				text += char + (source[++i] ?? "");
				continue;
			}
			if (char === quote || char === "\n") quote = undefined;
			text += char;
			continue;
		}
		if (char === '"' || char === "'") quote = char;
		else if (char === commentChar || source.startsWith("//", i) || source.startsWith("/*", i)) {
			const block = source.startsWith("/*", i);
			const end = block ? source.indexOf("*/", i + 2) : source.indexOf("\n", i);
			const stop = end < 0 ? source.length : block ? end + 2 : end;
			text += source.slice(i, stop).replace(/[^\n]/g, " ");
			i = stop - 1;
			continue;
		}
		text += char;
	}
	return text;
}
