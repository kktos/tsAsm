import { describe, expect, it, vi } from "vitest";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { DirectiveContext } from "../directives/directive.interface";
import { Logger } from "../logger.class";
import { Assembler } from "../polyasm";
import type { FileHandler, SegmentDefinition } from "../polyasm.types";

class CaptureLogger extends Logger {
	public lines: string[] = [];
	constructor() {
		super(true);
	}
	log(message: string): void {
		this.lines.push(message);
	}
	warn(message: string): void {
		this.lines.push(`[WARN] ${message}`);
	}
	error(message: string): void {
		this.lines.push(`[ERROR] ${message}`);
	}
}

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

describe("File Directive .INCLUDE", () => {
	const createAssembler = (segments: SegmentDefinition[] = DEFAULT_SEGMENTS) => {
		const mockFileHandler = new MockFileHandler();
		const logger = new CaptureLogger();
		const cpuHandler = new Cpu6502Handler();
		const textHandler = vi.fn((blockContent: string, _context: DirectiveContext) => blockContent);
		const handlers = { default: "TEXT", map: new Map([["TEXT", textHandler]]) };

		const assembler = new Assembler(cpuHandler, mockFileHandler, { logger, segments, rawDataProcessors: handlers });
		return { assembler, mockFileHandler, logger };
	};

	it("should include and assemble a source file", () => {
		const { assembler, mockFileHandler } = createAssembler();
		const includedCode = "LDA #$10\nSTA $0200";
		const source = `
				.INCLUDE "included.asm" ; include this file
				test = 99
			`;

		const mockReadSource = vi.fn(function (
			this: MockFileHandler, // Use 'any' or a more specific vitest mock type
			filename: string,
		): string {
			this.fullpath = filename;
			return includedCode;
		});

		const readSourceFileSpy = vi.spyOn(mockFileHandler, "readSourceFile").mockImplementation(mockReadSource);

		assembler.assemble(source);
		const result = assembler.link();

		expect(readSourceFileSpy).toHaveBeenCalledWith("included.asm", "");
		expect(result).toEqual([0xa9, 0x10, 0x8d, 0x00, 0x02]);
	});

	it("should log an error if the file to include is not found", () => {
		const { assembler, mockFileHandler } = createAssembler();
		const source = `.INCLUDE "nonexistent.asm"`;

		vi.spyOn(mockFileHandler, "readSourceFile").mockImplementation(() => {
			throw new Error("File not found");
		});

		expect(() => assembler.assemble(source)).toThrow("including file nonexistent.asm on line 1: Error: File not found");
	});

	it("should log an error if .INCLUDE is missing a filename argument", () => {
		const { assembler } = createAssembler();
		const source = ".INCLUDE";

		expect(() => assembler.assemble(source)).toThrow(".INCLUDE requires a string argument on line 1.");
	});

	it("should .INCLUDE file with a .FUNCTION holding a .DEFINE - bug fix", () => {
		const { assembler, mockFileHandler } = createAssembler();
		const includedCode = `
			.function displayHelpObj {
				.define spriteList
				- { id: $55, x: $0d, y: $30, name:"text key"}
				- { id: $27, x: 15, y: 60, name:"img key"}
				- { id: $57, x: $31, y: $27, name:"text locked door"}
				- { id: $5C, x: $3A, y: $3C, name:"img locked door"}
				- { id: $58, x: $59, y: $27, name:"text unlocked door"}
				- { id: $5d, x: $67, y: $3C, name:"img unlocked door"}
				- { id: $59, x: $25, y: $64, name:"text gem"}
				- { id: $28, x: $28, y: $6e, name:"img gem"}
				- { id: $5a, x: $53, y: $5b, name:"text gem holder"}
				- { id: $56, x: $5b, y: $6d, name:"img gem holder"}
				- { id: $5b, x: $2e, y: $88, name:"text extra sword"}
				- { id: $1e, x: $40, y: $9b, name:"img extra sword"}
				.end
				.echo spriteList
			}
			`;
		const source = `
				.INCLUDE "included.asm" ; include this file
				test = 99
			`;

		const mockReadSource = vi.fn(function (
			this: MockFileHandler, // Use 'any' or a more specific vitest mock type
			filename: string,
		): string {
			this.fullpath = filename;
			return includedCode;
		});
		vi.spyOn(mockFileHandler, "readSourceFile").mockImplementation(mockReadSource);

		assembler.assemble(source);
		const code = assembler.link();
		expect(code).toEqual([]);
	});

	it("should include and parse a IF correctly - bug fix", () => {
		const { assembler, mockFileHandler, logger } = createAssembler();
		const includedCode = `
			.echo "START OF INCLUDED FILE"

			.if * != $7900
			.error "this needs to be at $7900 !", "PC=",.hex(.pc)
			.end

			.echo "7900 =", .hex(.pc)
		`;
		const source = `
				.org $7900
				.INCLUDE "included.asm"
			`;

		const mockReadSource = vi.fn(function (this: MockFileHandler, filename: string): string {
			this.fullpath = filename;
			return includedCode;
		});

		vi.spyOn(mockFileHandler, "readSourceFile").mockImplementation(mockReadSource);

		assembler.assemble(source);

		// expect(logger.lines).toBe("");

		const found = logger.lines.find((l) => l === "7900 =	$7900");
		expect(found).toBeDefined();
	});
});
