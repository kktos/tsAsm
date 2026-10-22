import { beforeEach, describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { Segment } from "../linker/linker.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Directive: .fill", () => {
	let asm: Assembler;
	let segments: Segment[];

	beforeEach(() => {
		const cpu = new Cpu6502Handler();
		const fileHandler = new MockFileHandler();
		asm = new Assembler(cpu, fileHandler);
	});

	it("should fill a block of memory with a specified value", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .fill 5, $AB
        `;
		segments = asm.assemble(source);

		// expect(asm.PC.value).toBe(0x2005);

		const segment = segments[0];
		if (!segment) throw new Error("No segment found");

		const offset = 0x2000 - segment.start;
		const filledData = segment.data.slice(offset, offset + 5);
		expect(filledData).toEqual([0xab, 0xab, 0xab, 0xab, 0xab]);
	});

	it("should fill with 0 if no value is provided", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .fill 3
        `;
		segments = asm.assemble(source);

		// expect(asm.currentPC).toBe(0x2003);
		const segment = segments[0];
		if (!segment) throw new Error("No segment found");

		const offset = 0x2000 - segment.start;
		const filledData = segment.data.slice(offset, offset + 3);
		expect(filledData).toEqual([0, 0, 0]);
	});

	it("should evaluate expressions for count and value", () => {
		const source = `
            .cpu "6502"
            .org $2000
            value = $CC
            count = 2 * 2
            .fill count, value
        `;
		segments = asm.assemble(source);

		// expect(asm.currentPC).toBe(0x2004);
		const segment = segments[0];
		if (!segment) throw new Error("No segment found");

		const offset = 0x2000 - segment.start;
		const filledData = segment.data.slice(offset, offset + 4);
		expect(filledData).toEqual([0xcc, 0xcc, 0xcc, 0xcc]);
	});

	it("should do nothing if count is 0", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .fill 0, $FF
            LDA #$42
        `;
		segments = asm.assemble(source);

		// expect(asm.currentPC).toBe(0x2002);
		const segment = segments[0];
		if (!segment) throw new Error("No segment found");

		const offset = 0x2000 - segment.start;
		expect(segment.data[offset]).toBe(0xa9); // LDA immediate
		expect(segment.data[offset + 1]).toBe(0x42);
	});

	it.each([
		[".fill -5, $FF", ".FILL count: -5"],
		[".ds -1", ".DS count: -1"],
		[".fill 5/2", ".FILL count: 2.5"],
		[".fill count\ncount = -2", ".FILL count: -2"],
	])("should throw on a count that isn't a whole number of 0 or more: %j", (source, message) => {
		expect(() => asm.assemble(`.org $2000\n${source}\nlabel: LDA #$42`)).toThrow(
			expect.objectContaining({ message: `${message} isn't a whole number of bytes (0 or more).`, location: expect.objectContaining({ line: 2 }) }),
		);
	});
});
