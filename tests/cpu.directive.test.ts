import { beforeEach, describe, expect, it } from "vitest";
import { Cpu65C02Handler } from "../src/cpu/cpu65c02.class";
import { Cpu6502Handler } from "../src/cpu/cpu6502.class";
import { Assembler } from "../src/polyasm";
import type { FileHandler, SegmentDefinition } from "../src/polyasm.types";

// A simple mock for the FileHandler so we don't need to interact with the filesystem.
class MockFileHandler implements FileHandler {
	readSourceFile(_filename: string): string {
		return ""; // Not used in these tests
	}
	readBinaryFile(_filename: string): number[] {
		return []; // Not used in these tests
	}
}

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("CpuDirective", () => {
	let assembler: Assembler;
	let fileHandler: MockFileHandler;

	beforeEach(() => {
		fileHandler = new MockFileHandler();
		// Initialize the assembler with the 6502 handler by default for each test.
		assembler = new Assembler(new Cpu6502Handler(), fileHandler, { segments: DEFAULT_SEGMENTS });
	});

	it('should switch the CPU handler from 6502 to 65C02 when .cpu "65C02" is used', () => {
		const source = `
			.cpu "65C02"
			NOP  ; A simple instruction to ensure assembly runs
		`;

		// 1. Check initial state
		expect(assembler.getCPUHandler()).toBeInstanceOf(Cpu6502Handler);

		// 2. Assemble the code
		assembler.assemble(source);

		// 3. Verify the handler was switched
		expect(assembler.getCPUHandler()).toBeInstanceOf(Cpu65C02Handler);
		expect(assembler.getCPUHandler().cpuType).toBe("65C02");
	});

	it("should correctly assemble a 65C02-specific instruction after switching", () => {
		const source = `
			.processor "65C02"
			STZ $44      ; STZ is a 65C02-only instruction (Opcode  for ZP)
		`;

		const segments = assembler.assemble(source);
		const codeSegment = segments.find((s) => s.name === "CODE");

		// Verify that the output bytes match the expected opcode and operand for STZ
		expect(codeSegment?.data).toEqual([0x64, 0x44]);
	});

	it("should throw an error if a 65C02-specific instruction is used with the default 6502 handler", () => {
		const source = `
			STZ $44      ; This should fail because the default CPU is 6502
		`;

		// const segments = assembler.assemble(source);
		// expect(segments).toEqual([]);

		// const codeSegment = segments.find((s) => s.name === "CODE");
		// expect(codeSegment?.data).toEqual([0x64, 0x44]);

		expect(() => assembler.assemble(source)).toThrow(/Syntax error in line 2/);
	});
});
