import { beforeEach, describe, expect, it, vi } from "vitest";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../logger.class";
import { Assembler } from "../polyasm";
import type { FileHandler, SegmentDefinition } from "../polyasm.types";

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

class MockFileHandler implements FileHandler {
	fullpath = "";
	readSourceFile(filename: string): string {
		throw new Error(`Mock file not found: "${filename}"`);
	}
	readBinaryFile(filename: string): number[] {
		throw new Error(`Mock bin file not found: ${filename}`);
	}
}

describe("Bug Fixes", () => {
	let assembler: Assembler;
	let logger: Logger;
	let cpu6502: Cpu6502Handler;
	let mockFileHandler: MockFileHandler;

	beforeEach(() => {
		logger = new Logger();
		cpu6502 = new Cpu6502Handler();
		mockFileHandler = new MockFileHandler();
		assembler = new Assembler(cpu6502, mockFileHandler, { logger, segments: DEFAULT_SEGMENTS });
	});

	it("should fix the read_file macro bug", () => {
		const includedCode = `
				.macro read_file(filename) {
					; WDM disk_read_file
					.db $42, $11
					.dw filename

			:		bit $C0FF
					bpl :-
				}

					read_file fwelcome
					jmp $2000

			fwelcome:
					.cstr "WELCOME"

			`;
		const source = `
				.INCLUDE "included.asm"
			`;

		const mockReadSource = vi.fn(function (this: MockFileHandler, filename: string): string {
			this.fullpath = filename;
			return includedCode;
		});

		vi.spyOn(mockFileHandler, "readSourceFile").mockImplementation(mockReadSource);

		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([87, 69, 76, 67, 79, 77, 69, 0]);
		expect(assembler.symbolTable.lookupSymbol("fwelcome")).toBe(0x1000);
	});
});
