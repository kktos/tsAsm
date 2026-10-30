export function getHex(val: number, length?: number) {
	// A negative value is shown as the bytes hold it: its two's complement, over as many digits as a
	// positive value would get, and more if it doesn't fit (as a positive value overflows `length`).
	if (val < 0) {
		let digits = length ?? (val >= -0x80 ? 2 : val >= -0x8000 ? 4 : val >= -0x800000 ? 6 : 8);
		while (val < -(16 ** digits) / 2) digits++;
		return (16 ** digits + val).toString(16).toUpperCase();
	}

	// Without `length`, as many digits as the bytes holding it: 2, 4, 6 or 8.
	const pad = length ?? (val < 0x100 ? 2 : val < 0x10000 ? 4 : val < 0x1000000 ? 6 : 8);
	return val.toString(16).toUpperCase().padStart(pad, "0");
}

/** An address or an offset: 4 digits up to $FFFF (`0080`), then as getHex writes it, 6 up to $FFFFFF (`123456`), else 8. */
export function getAddressHex(address: number): string {
	return getHex(address, address > 0xffff ? undefined : 4);
}
