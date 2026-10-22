import { describe, expect, it } from "vitest";
import { pushSignedNumber } from "./array.utils";

describe("pushSignedNumber", () => {
	const push = (value: number, bitSize: 8 | 16 | 32, isLittleEndian = true) => {
		const list: number[] = [];
		pushSignedNumber(list, value, bitSize, isLittleEndian);
		return list;
	};

	it.each([
		[-1, 8, [0xff]],
		[-128, 8, [0x80]],
		[127, 8, [0x7f]],
		[-1, 16, [0xff, 0xff]],
		[-32768, 16, [0x00, 0x80]],
		[-1, 32, [0xff, 0xff, 0xff, 0xff]],
		[-2, 32, [0xfe, 0xff, 0xff, 0xff]],
		[-2147483648, 32, [0x00, 0x00, 0x00, 0x80]],
		[2147483647, 32, [0xff, 0xff, 0xff, 0x7f]],
	] as const)("should write %d on %d bits as its two's complement", (value, bitSize, bytes) => {
		expect(push(value, bitSize)).toEqual(bytes);
	});

	it("should write big endian", () => {
		expect(push(-2, 32, false)).toEqual([0xff, 0xff, 0xff, 0xfe]);
		expect(push(-2, 16, false)).toEqual([0xff, 0xfe]);
	});

	it("should throw on a value out of range", () => {
		expect(() => push(-2147483649, 32)).toThrow(RangeError);
		expect(() => push(128, 8)).toThrow(RangeError);
	});
});
