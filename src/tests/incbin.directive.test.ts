import { posix } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { DirectiveContext } from "../directives/directive.interface";
import { MockFileHandler } from "./mockfilehandler.class";

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

		expect(readBinaryFileSpy).toHaveBeenCalledWith("data.bin", "");
		expect(result).toEqual(binaryData);
	});

	it("should throw an error if the binary file is not found", () => {
		const { assembler, mockFileHandler } = createAssembler();
		const source = `.INCBIN "nonexistent.bin"`;

		const readBinaryFileSpy = vi.spyOn(mockFileHandler, "readBinaryFile").mockImplementation(() => {
			throw new Error("File not found");
		});

		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: "Can't include binary file 'nonexistent.bin': File not found",
				location: expect.objectContaining({ line: 1 }),
			}),
		);
		expect(readBinaryFileSpy).toHaveBeenCalledWith("nonexistent.bin", "");
	});

	it("should log an error if .INCBIN is missing a filename argument", () => {
		const { assembler } = createAssembler();
		const source = ".INCBIN";

		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: ".INCBIN requires a string argument.",
				location: expect.objectContaining({ line: 1 }),
			}),
		);
	});

	describe("paths", () => {
		// Paths are resolved from the including file, as the CLI does.
		const withFilesAt = (sources: Record<string, string>, binaries: Record<string, number[]>) => {
			const { assembler, mockFileHandler } = createAssembler();
			const resolve = (handler: MockFileHandler, filename: string, from?: string) => {
				handler.fullpath = from ? posix.join(posix.dirname(from), filename) : filename;
				handler.filename = posix.basename(filename);
				return handler.fullpath;
			};
			vi.spyOn(mockFileHandler, "readSourceFile").mockImplementation(function (this: MockFileHandler, filename: string, from?: string) {
				const path = resolve(this, filename, from);
				const source = sources[path];
				if (source === undefined) throw new Error(`no file ${path}`);
				return source;
			});
			vi.spyOn(mockFileHandler, "readBinaryFile").mockImplementation(function (this: MockFileHandler, filename: string, from?: string) {
				const path = resolve(this, filename, from);
				const bytes = binaries[path];
				if (bytes === undefined) throw new Error(`no file ${path}`);
				return bytes;
			});
			return assembler;
		};
		const binaries = { "data.bin": [1], "lib/data.bin": [2], "macros/data.bin": [3] };

		it("should read a binary file from the directory of the file that includes it, as .include", () => {
			const assembler = withFilesAt({ "lib/lib.asm": '.incbin "data.bin"' }, binaries);
			assembler.assemble(`
				.incbin "data.bin"
				.include "lib/lib.asm"
			`);
			expect(assembler.link()).toEqual([1, 2]);
		});

		it("should read a binary file in a macro body from the file the macro is called in, as .include", () => {
			const sources = {
				"macros/macros.asm": `
					.macro m
						.incbin "data.bin"
					.end
				`,
				"lib/lib.asm": "m",
			};
			const assembler = withFilesAt(sources, binaries);
			assembler.assemble(`
				.include "macros/macros.asm"
				.include "lib/lib.asm"
			`);
			expect(assembler.link()).toEqual([2]);
		});

		it("should name the path it read in the error of a missing file", () => {
			const assembler = withFilesAt({ "lib/lib.asm": '.incbin "nope.bin"' }, binaries);
			expect(() => assembler.assemble('.include "lib/lib.asm"')).toThrow("Can't include binary file 'nope.bin': no file lib/nope.bin");
		});
	});
});
