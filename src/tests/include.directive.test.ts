import { posix } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { DirectiveContext } from "../directives/directive.interface";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("File Directive .INCLUDE", () => {
	const createAssembler = (segments: SegmentDefinition[] = DEFAULT_SEGMENTS) => {
		const mockFileHandler = new MockFileHandler();
		const cpuHandler = new Cpu6502Handler();
		const textHandler = vi.fn((blockContent: string, _context: DirectiveContext) => blockContent);
		const handlers = { default: "TEXT", map: new Map([["TEXT", textHandler]]) };
		const sink = new MemorySink();
		const logger = new Logger({ sink, enabled: true });
		const assembler = new Assembler(cpuHandler, mockFileHandler, {
			logger,
			segments,
			rawDataProcessors: handlers,
			log: { pass1Enabled: true, pass2Enabled: true },
		});
		return { assembler, mockFileHandler, sink };
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

		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: "Can't include 'nonexistent.asm': File not found",
				location: expect.objectContaining({ line: 1 }),
			}),
		);
	});

	it("should log an error if .INCLUDE is missing a filename argument", () => {
		const { assembler } = createAssembler();
		const source = ".INCLUDE";

		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: ".INCLUDE requires a string argument.",
				location: expect.objectContaining({ line: 1 }),
			}),
		);
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
		const { assembler, mockFileHandler, sink } = createAssembler();
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

		const found = sink.logs.find((l) => l === "7900 =	$7900");
		expect(found).toBeDefined();
	});

	describe("include cycles", () => {
		const files: Record<string, string> = {
			"self.asm": '.include "self.asm"',
			"a.asm": '.include "b.asm"',
			"b.asm": '.include "a.asm"',
			"leaf.asm": ".db 1",
		};
		const withFiles = () => {
			const { assembler, mockFileHandler } = createAssembler();
			vi.spyOn(mockFileHandler, "readSourceFile").mockImplementation(function (this: MockFileHandler, filename: string) {
				this.fullpath = filename;
				this.filename = filename;
				return files[filename] ?? "";
			});
			return assembler;
		};

		it("should throw when a file includes itself", () => {
			expect(() => withFiles().assemble('.include "self.asm"')).toThrow("Include cycle: self.asm -> self.asm");
		});

		it("should throw on an indirect include cycle", () => {
			expect(() => withFiles().assemble('.include "a.asm"')).toThrow("Include cycle: a.asm -> b.asm -> a.asm");
		});

		it("should still allow including the same file several times", () => {
			const assembler = withFiles();
			assembler.assemble('.include "leaf.asm"\n.include "leaf.asm"');
			expect(assembler.link()).toEqual([1, 1]);
		});
	});

	describe("a file included several times", () => {
		const withFiles = (files: Record<string, string>) => {
			const { assembler, mockFileHandler } = createAssembler();
			vi.spyOn(mockFileHandler, "readSourceFile").mockImplementation(function (this: MockFileHandler, filename: string) {
				this.fullpath = filename;
				this.filename = filename;
				return files[filename] ?? "";
			});
			return assembler;
		};

		it("should go on with the statements after the second include", () => {
			const assembler = withFiles({ "res.asm": ".db 5" });
			assembler.assemble(`
				.include "res.asm"
				.db 8
				.include "res.asm"
				.db 9
				.db 10
			`);
			expect(assembler.link()).toEqual([5, 8, 5, 9, 10]);
		});

		it("should go on with the including file when it was included from another file", () => {
			const assembler = withFiles({
				"lib.asm": `
					.include "res.asm"
					.db 1
				`,
				"res.asm": ".db 5",
			});
			assembler.assemble(`
				.include "lib.asm"
				.include "res.asm"
				.db 9
			`);
			expect(assembler.link()).toEqual([5, 1, 5, 9]);
		});

		it("should assemble the raw blocks of a file included twice", () => {
			const assembler = withFiles({ "res.asm": ".hex { 0E 60 }" });
			assembler.assemble(`
				.include "res.asm"
				.include "res.asm"
				.db 9
			`);
			expect(assembler.link()).toEqual([0x0e, 0x60, 0x0e, 0x60, 9]);
		});

		it("should define the labels of a file included in two namespaces in each", () => {
			const assembler = withFiles({
				"res.asm": `
					sprite:
					.db 1, 2
				`,
			});
			assembler.assemble(`
				.namespace a
				.include "res.asm"
				.end namespace
				.namespace b
				.include "res.asm"
				.end namespace
				.db <a::sprite, <b::sprite
			`);
			expect(assembler.link()).toEqual([1, 2, 1, 2, 0x00, 0x02]);
		});
	});

	describe(".once", () => {
		// Paths are resolved from the including file, as the CLI does.
		const withFiles = (files: Record<string, string>) => {
			const { assembler, mockFileHandler } = createAssembler();
			vi.spyOn(mockFileHandler, "readSourceFile").mockImplementation(function (this: MockFileHandler, filename: string, from?: string) {
				this.fullpath = from ? posix.join(posix.dirname(from), filename) : filename;
				this.filename = posix.basename(filename);
				const source = files[this.fullpath];
				if (source === undefined) throw new Error(`no file ${this.fullpath}`);
				return source;
			});
			return assembler;
		};

		it("should define the macros of a file included twice only once", () => {
			const assembler = withFiles({
				"macros.asm": `
					.once
					.macro twice v
						.db v, v
					.end
				`,
				"a.asm": `
					.include "macros.asm"
					twice 1
				`,
				"b.asm": `
					.include "macros.asm"
					twice 2
				`,
			});
			assembler.assemble(`
				.include "a.asm"
				.include "b.asm"
			`);
			expect(assembler.link()).toEqual([1, 1, 2, 2]);
		});

		it("should assemble the code and labels of a file included twice only once, in both passes", () => {
			const assembler = withFiles({
				"data.asm": `
					.once
					table:
					.db 7, 8
				`,
			});
			assembler.assemble(`
				.include "data.asm"
				.include "data.asm"
				lda table
			`);
			expect(assembler.link()).toEqual([7, 8, 0xad, 0x00, 0x10]);
		});

		it("should know a file by its path, whatever the path it is included with", () => {
			const assembler = withFiles({
				"includes/macros.asm": `
					.once
					.macro one
						.db 1
					.end
				`,
				"modules/lib/lib.asm": `
					.include "../../includes/macros.asm"
					one
				`,
			});
			assembler.assemble(`
				.include "includes/macros.asm"
				.include "modules/lib/lib.asm"
			`);
			expect(assembler.link()).toEqual([1]);
		});

		it("should still include twice a file without .once", () => {
			const assembler = withFiles({
				"once.asm": `
					.once
					.include "res.asm"
				`,
				"res.asm": ".db 5",
			});
			assembler.assemble(`
				.include "once.asm"
				.include "res.asm"
				.include "once.asm"
			`);
			expect(assembler.link()).toEqual([5, 5]);
		});

		it("should include a .once file again in a new assembly", () => {
			const assembler = withFiles({
				"data.asm": `
					.once
					.db 3
				`,
			});
			assembler.assemble('.include "data.asm"');
			expect(assembler.link()).toEqual([3]);
			assembler.assemble('.include "data.asm"');
			expect(assembler.link()).toEqual([3]);
		});

		it("should throw when .once is given an argument", () => {
			expect(() => withFiles({}).assemble(".once 1")).toThrow(".ONCE takes no argument.");
		});
	});
});
