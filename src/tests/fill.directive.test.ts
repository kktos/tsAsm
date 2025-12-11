import { beforeEach, describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { FileHandler } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { Segment } from "../linker/linker.class";

class MockFileHandler implements FileHandler {
	fullpath = "";
	readSourceFile(filename: string): string {
		throw new Error(`Mock file not found: "${filename}"`);
	}
	readBinaryFile(filename: string): number[] {
		throw new Error(`Mock bin file not found: ${filename}`);
	}
}

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

		expect(asm.currentPC).toBe(0x2005);

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

		expect(asm.currentPC).toBe(0x2003);
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

		expect(asm.currentPC).toBe(0x2004);
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

		expect(asm.currentPC).toBe(0x2002);
		const segment = segments[0];
		if (!segment) throw new Error("No segment found");

		const offset = 0x2000 - segment.start;
		expect(segment.data[offset]).toBe(0xa9); // LDA immediate
		expect(segment.data[offset + 1]).toBe(0x42);
	});

	it("should do nothing if count is negative", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .fill -5, $FF
            LDA #$42
        `;
		segments = asm.assemble(source);

		expect(asm.currentPC).toBe(0x2002);
		const segment = segments[0];
		if (!segment) throw new Error("No segment found");

		const offset = 0x2000 - segment.start;
		expect(segment.data[offset]).toBe(0xa9); // LDA immediate
		expect(segment.data[offset + 1]).toBe(0x42);
	});
});
