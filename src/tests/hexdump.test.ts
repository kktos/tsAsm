import { describe, expect, it } from "vitest";
import { hexDump } from "../utils/hexdump.util";

describe("hexDump", () => {
	it("writes an address up to $FFFF on 4 digits", () => {
		expect(hexDump(0x80, [1, 2])).toBe("0080:  01 02");
	});

	it("writes an address over $FFFF on 6 digits, from the line crossing it", () => {
		const bytes = Array.from({ length: 24 }, (_, i) => i);
		expect(hexDump(0xfff8, bytes).split("\n")).toEqual(["FFF8:  00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F", "010008:  10 11 12 13 14 15 16 17"]);
	});

	it("writes an address over $FFFFFF on 8 digits", () => {
		expect(hexDump(0x1000000, [1])).toBe("01000000:  01");
	});
});
