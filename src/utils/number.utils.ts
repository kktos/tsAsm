/**
 * Throws unless `value` fits in `byteCount` bytes, as a signed or an unsigned number:
 * a byte accepts -128..255, a word -32768..65535.
 * @param description what the value is, for the error message (e.g. ".DB value on line 3")
 */
export function assertFitsInBytes(value: number, byteCount: number, description: string) {
	const bits = byteCount * 8;
	const min = -(2 ** (bits - 1));
	const max = 2 ** bits - 1;
	if (value < min || value > max)
		throw new Error(`${description} ${value} doesn't fit in ${byteCount === 1 ? "a byte" : `${byteCount} bytes`} (${min}..${max}).`);
}
