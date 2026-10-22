/** The bytes of a string, one per character: a character above 255 doesn't fit in a byte, so it's an error. */
export function stringToBytes(str: string, description: string): number[] {
	const bytes: number[] = [];
	for (const char of str) {
		const code = char.codePointAt(0) as number;
		if (code > 0xff) throw new Error(`${description} '${char}' (U+${code.toString(16).toUpperCase().padStart(4, "0")}) doesn't fit in a byte.`);
		bytes.push(code);
	}
	return bytes;
}
