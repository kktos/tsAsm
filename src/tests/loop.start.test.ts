import { describe, expect, it, vi } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { AssemblerOptions } from "../assembler/polyasm.types";
import { MockFileHandler } from "./mockfilehandler.class";

// Minimal fake CPU handler
const fakeCPU = {
	cpuType: "FakeCPU",
	isInstruction: () => false,
	resolveAddressingMode: () => ({
		mode: "",
		opcode: 0,
		bytes: 0,
		resolvedAddress: 0,
	}),
	encodeInstruction: () => [],
	endianness: "little" as const,
};

const createAssembler = (options?: AssemblerOptions["options"], files: Record<string, string> = {}) => {
	const fileHandler = new MockFileHandler();
	vi.spyOn(fileHandler, "readSourceFile").mockImplementation(function (this: MockFileHandler, filename: string) {
		this.fullpath = filename;
		this.filename = filename;
		const source = files[filename];
		if (source === undefined) throw new Error(`Mock file not found: "${filename}"`);
		return source;
	});
	return new Assembler(fakeCPU, fileHandler, { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }], options });
};

const assemble = (source: string, options?: AssemblerOptions["options"], files?: Record<string, string>) => {
	const assembler = createAssembler(options, files);
	assembler.assemble(source);
	return assembler.link();
};

describe("Loop header: AS <iterator> FROM <start>", () => {
	it.each([
		[".repeat 3 AS i junk", ".REPEAT: unexpected 'junk' after the iterator: only FROM <start> can follow it.", 16],
		[".repeat 3 AS i, j", ".REPEAT: unexpected ',' after the iterator: only FROM <start> can follow it.", 15],
		[".repeat 3 AS", ".REPEAT: AS must be followed by the iterator's name.", 11],
		[".repeat 3 AS 5", ".REPEAT: AS must be followed by the iterator's name.", 14],
		[".repeat 3 FROM 0", ".REPEAT: FROM needs an iterator: AS <iterator> FROM <start>.", 11],
		[".repeat 3 AS i FROM", ".REPEAT: FROM must be followed by the iterator's first value.", 16],
		[".for x of a AS i junk", ".FOR: unexpected 'junk' after the index: only FROM <start> can follow it.", 18],
		[".for x of a AS", ".FOR: AS must be followed by the index's name.", 13],
		[".for x of a FROM 1", ".FOR: FROM needs an index: AS <index> FROM <start>.", 13],
	])("rejects %j", (header, message, column) => {
		const source = `
			a = [7, 8]
			${header}
				.db 1
			.end
		`;
		expect(() => assemble(source)).toThrow(expect.objectContaining({ message, location: expect.objectContaining({ line: 3, column: column + 3 }) }));
	});

	it("starts .repeat's iterator at FROM's value", () => {
		const source = `
			.repeat 3 AS i FROM 0
				.db i
			.end
		`;
		expect(assemble(source)).toEqual([0, 1, 2]);
	});

	it("starts .for's index at FROM's value, its items still at the first", () => {
		const source = `
			a = [7, 8]
			.for x of a AS i FROM 1
				.db i, x
			.end
		`;
		expect(assemble(source)).toEqual([1, 7, 2, 8]);
	});

	it("takes any whole number as FROM's value, from an expression", () => {
		const source = `
			first = 5
			.repeat 2 AS i FROM first * 2
				.db i
			.end
			.repeat 3 AS i FROM -1
				.db i
			.end
		`;
		expect(assemble(source)).toEqual([10, 11, 0xff, 0, 1]);
	});

	it("rejects a FROM value that isn't a whole number", () => {
		const source = `
			.repeat 2 AS i FROM 5/2
				.db i
			.end
		`;
		expect(() => assemble(source)).toThrow(expect.objectContaining({ message: ".REPEAT FROM: 2.5 isn't a whole number." }));
	});

	it("rejects a FROM value using a symbol defined later", () => {
		const source = `
			.repeat 2 AS i FROM first
				.db i
			.end
			first = 1
		`;
		expect(() => assemble(source)).toThrow(
			expect.objectContaining({
				message: ".REPEAT: 'FIRST' must be defined before it is used here (the iterator's first value is needed in pass 1).",
			}),
		);
	});
});

describe("Options repeat.start and for.start", () => {
	it("default to .repeat from 1 and .for from 0", () => {
		const source = `
			.repeat 2 AS i
				.db i
			.end
			.for x of [7, 8] AS i
				.db i
			.end
		`;
		expect(assemble(source)).toEqual([1, 2, 0, 1]);
	});

	it("are set by .option, from the next statement on", () => {
		const source = `
			.option repeat.start 0
			.option for.start 1
			.repeat 2 AS i
				.db i
			.end
			.for x of [7, 8] AS i
				.db i
			.end
		`;
		expect(assemble(source)).toEqual([0, 1, 1, 2]);
	});

	it("are set by the options given to the assembler", () => {
		const source = `
			.repeat 2 AS i
				.db i
			.end
			.for x of [7, 8] AS i
				.db i
			.end
		`;
		expect(assemble(source, { "repeat.start": 0, "for.start": 1 })).toEqual([0, 1, 1, 2]);
	});

	it("give way to FROM", () => {
		const source = `
			.option repeat.start 0
			.repeat 2 AS i FROM 1
				.db i
			.end
		`;
		expect(assemble(source)).toEqual([1, 2]);
	});

	it("apply in a loop's body from the next statement on", () => {
		const source = `
			.repeat 1
				.option repeat.start 0
				.repeat 2 AS i
					.db i
				.end
			.end
		`;
		expect(assemble(source)).toEqual([0, 1]);
	});

	it.each([[`2`], [`"0"`], [`-1`]])("can only be 0 or 1, not %s", (value) => {
		expect(() => assemble(`.option repeat.start ${value}`)).toThrow("'repeat.start' must be one of 0, 1.");
		expect(() => assemble(`.option for.start ${value}`)).toThrow("'for.start' must be one of 0, 1.");
	});

	it("can only be 0 or 1 in the options given to the assembler", () => {
		expect(() => createAssembler({ "repeat.start": 2 })).toThrow("'repeat.start' must be one of 0, 1.");
	});

	describe("in an included file", () => {
		const files = {
			"loop.s": `
				.repeat 2 AS i
					.db i
				.end
			`,
			"sets.s": `
				.option repeat.start 0
				.repeat 2 AS i
					.db i
				.end
			`,
		};

		it("are the ones the assembler was given, not the includer's", () => {
			const source = `
				.option repeat.start 0
				.include "loop.s"
			`;
			expect(assemble(source, {}, files)).toEqual([1, 2]);
			expect(assemble(source, { "repeat.start": 0 }, files)).toEqual([0, 1]);
			expect(assemble(`.include "loop.s"`, { "repeat.start": 0 }, files)).toEqual([0, 1]);
		});

		it("set by .option in the file, last until its end", () => {
			const source = `
				.include "sets.s"
				.repeat 2 AS i
					.db i
				.end
			`;
			expect(assemble(source, {}, files)).toEqual([0, 1, 1, 2]);
		});

		it("are the includer's again after the file", () => {
			const source = `
				.option repeat.start 0
				.include "loop.s"
				.repeat 2 AS i
					.db i
				.end
			`;
			expect(assemble(source, {}, files)).toEqual([1, 2, 0, 1]);
		});
	});

	describe("in a macro", () => {
		it("are the ones where the macro is defined, not where it's called", () => {
			const files = {
				"lib.s": `
					.macro table n
						.repeat n AS i
							.db i
						.end
					.end
				`,
			};
			const source = `
				.option repeat.start 0
				.include "lib.s"
				table 3
			`;
			expect(assemble(source, {}, files)).toEqual([1, 2, 3]);
		});

		it("are the ones where the macro is defined, even when the caller changed them back", () => {
			const source = `
				.option repeat.start 0
				.macro table n
					.repeat n AS i
						.db i
					.end
				.end
				.option repeat.start 1
				table 2
			`;
			expect(assemble(source)).toEqual([0, 1]);
		});

		it("set by .option in the body, last until the end of the call", () => {
			const source = `
				.macro table n
					.option repeat.start 0
					.repeat n AS i
						.db i
					.end
				.end
				table 2
				.repeat 2 AS i
					.db i
				.end
			`;
			expect(assemble(source)).toEqual([0, 1, 1, 2]);
		});

		it("are the caller's again after a call", () => {
			const source = `
				.macro m
					.db $ff
				.end
				.option repeat.start 0
				m
				.repeat 2 AS i
					.db i
				.end
			`;
			expect(assemble(source)).toEqual([0xff, 0, 1]);
		});
	});
});
