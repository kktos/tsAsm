import { describe, expect, it, vi } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { FileHandler, SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { DirectiveContext } from "../directives/directive.interface";

class MockFileHandler implements FileHandler {
	fullpath = "";
	readSourceFile(filename: string): string {
		throw new Error(`Mock file not found: ${filename}`);
	}

	readBinaryFile(filename: string): number[] {
		throw new Error(`Mock bin file not found: ${filename}`);
	}
}

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("File Directive .INCBIN", () => {
	const createAssembler = (segments: SegmentDefinition[] = DEFAULT_SEGMENTS) => {
		const mockFileHandler = new MockFileHandler();
		const cpuHandler = new Cpu6502Handler();
		const textHandler = vi.fn((blockContent: string, _context: DirectiveContext) => blockContent);
		const handlers = { default: "TEXT", map: new Map([["TEXT", textHandler]]) };

		const assembler = new Assembler(cpuHandler, mockFileHandler, { segments, rawDataProcessors: handlers });
		return { assembler, mockFileHandler };
	};

	it("should include a binary file", () => {
		const { assembler, mockFileHandler } = createAssembler();
		const binaryData = [0x01, 0x02, 0x03, 0x04];
		const source = `
				.INCBIN "data.bin"
			`;

		const readBinaryFileSpy = vi.spyOn(mockFileHandler, "readBinaryFile").mockReturnValue(binaryData);

		assembler.assemble(source);
		const result = assembler.link();

		expect(readBinaryFileSpy).toHaveBeenCalledWith("data.bin");
		expect(result).toEqual(binaryData);
	});

	it("should throw an error if the binary file is not found", () => {
		const { assembler, mockFileHandler } = createAssembler();
		const source = `.INCBIN "nonexistent.bin"`;

		const readBinaryFileSpy = vi.spyOn(mockFileHandler, "readBinaryFile").mockImplementation(() => {
			throw new Error("File not found");
		});

		expect(() => assembler.assemble(source)).toThrow("Assembly failed on line 1: Binary include failed.");
		expect(readBinaryFileSpy).toHaveBeenCalledWith("nonexistent.bin");
	});

	it("should log an error if .INCBIN is missing a filename argument", () => {
		const { assembler } = createAssembler();
		const source = ".INCBIN";

		expect(() => assembler.assemble(source)).toThrow("[PASS 1] ERROR: .INCBIN requires a string argument on line 1.");
	});
});
