export function getHex(val: number, length?: number) {
	// A negative value is shown as the bytes hold it: its two's complement, over as many digits as a
	// positive value would get, and more if it doesn't fit (as a positive value overflows `length`).
	if (val < 0) {
		let digits = length ?? (val >= -0x80 ? 2 : val >= -0x8000 ? 4 : 8);
		while (val < -(16 ** digits) / 2) digits++;
		return (16 ** digits + val).toString(16).toUpperCase();
	}

	let pad = 0;
	if (length === undefined) {
		if (val < 0x100) pad = 2;
		else if (val < 0x10000) pad = 4;
		else pad = 8;
	} else {
		pad = length;
	}
	return val.toString(16).toUpperCase().padStart(pad, "0");
}
