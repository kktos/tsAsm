import { describe, expect, it } from "vitest";
import { stringToBytes } from "./string.utils";

describe("stringToBytes", () => {
	it("should give one byte per character, up to 255", () => {
		expect(stringToBytes("Aé\xff", "test:")).toEqual([0x41, 0xe9, 0xff]);
	});

	it.each([
		["a€", "'€' (U+20AC)"],
		["😀", "'😀' (U+1F600)"],
		["Ā", "'Ā' (U+0100)"],
	])("should throw on a character above 255: %j", (str, char) => {
		expect(() => stringToBytes(str, "test:")).toThrow(`test: ${char} doesn't fit in a byte.`);
	});
});
