import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { AssemblerOptions, FileHandler } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";

class FilesHandler implements FileHandler {
	fullpath = "";
	filename = "";
	constructor(private readonly files: Record<string, string>) {}
	readSourceFile(filename: string): string {
		const source = this.files[filename];
		if (source === undefined) throw new Error(`File not found: "${filename}"`);
		this.fullpath = filename;
		this.filename = filename;
		return source;
	}
	readBinaryFile(): number[] {
		return [];
	}
}

const setup = (files: Record<string, string> = {}, options: AssemblerOptions = {}) =>
	new Assembler(new Cpu6502Handler(), new FilesHandler(files), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }], ...options });

const assemble = (source: string, files?: Record<string, string>, options?: AssemblerOptions) => {
	const assembler = setup(files, options);
	assembler.assemble(source);
	return assembler.link();
};

describe("local.prefix and anon.marker options", () => {
	describe("take effect from the next line", () => {
		it("local.prefix, on the line right after the .option", () => {
			const source = `
				start:
					.option local.prefix "@"
				@loop	dex
					bne @loop
			`;
			expect(assemble(source)).toEqual([0xca, 0xd0, 0xfd]);
		});

		it("local.prefix, on the line right after the .option, lexed ahead as something else", () => {
			const source = `
				start:
					.option local.prefix "!"
				!loop	dex
					bne !loop
			`;
			expect(assemble(source)).toEqual([0xca, 0xd0, 0xfd]);
		});

		it("anon.marker, on the line right after the .option", () => {
			const source = `
					.option anon.marker "@"
				:
					nop
			`;
			expect(() => assemble(source)).toThrow(
				expect.objectContaining({ message: "Unexpected character ':' (U+003A).", location: expect.objectContaining({ line: 3 }) }),
			);
		});

		it("set in a macro, on the line after the macro call", () => {
			const source = `
					.macro useAt
					.option local.prefix "@"
					.end
				start:
					useAt
				@loop	dex
					bne @loop
			`;
			expect(assemble(source)).toEqual([0xca, 0xd0, 0xfd]);
		});
	});

	it("a char for local labels, another for anonymous labels", () => {
		const source = `
				.option local.prefix "@"
			start:
			@loop	dex
				bne @loop
			:	dey
				bne :-
				beq :+
				nop
			:	rts
		`;
		expect(assemble(source)).toEqual([0xca, 0xd0, 0xfd, 0x88, 0xd0, 0xfd, 0xf0, 0x01, 0xea, 0x60]);
	});

	it("a marker char keeps its meaning where it isn't an anonymous label", () => {
		const source = `
				.option anon.marker "!"
			!	.db !0, 1 != 2
				bne !-
		`;
		expect(assemble(source)).toEqual([0x01, 0x01, 0xd0, 0xfc]);
	});

	describe("included files", () => {
		it("an included file can have its own prefix", () => {
			const source = `
				start:
					.option local.prefix "@"
					.include "foreign.asm"
					.option local.prefix ":"
				back:
				:loop	dex
					bne :loop
			`;
			const foreign = `
				foreign:
				@loop	dey
					bne @loop
			`;
			expect(assemble(source, { "foreign.asm": foreign })).toEqual([0x88, 0xd0, 0xfd, 0xca, 0xd0, 0xfd]);
		});

		it("an .option in an included file applies from the line after the .include", () => {
			const source = `
				start:
					.include "options.asm"
				@loop	dex
					bne @loop
			`;
			const options = `
					.option local.prefix "@"
			`;
			expect(assemble(source, { "options.asm": options })).toEqual([0xca, 0xd0, 0xfd]);
		});

		it("a file included again is lexed with the prefix of then", () => {
			const source = `
				first:
					.option local.prefix "@"
					.include "inc.asm"
				second:
					.option local.prefix ":"
					.include "inc.asm"
			`;
			const inc = `
				@a	nop
			`;
			expect(() => assemble(source, { "inc.asm": inc })).toThrow(
				expect.objectContaining({ message: "Unexpected character '@' (U+0040).", location: expect.objectContaining({ file: "inc.asm", line: 2 }) }),
			);
		});
	});

	it("a macro body keeps the prefix of where the macro is defined", () => {
		const source = `
				.option local.prefix "@"
				.macro wait
			@loop	dex
				bne @loop
				.end
				.option local.prefix ":"
			start:
				wait
			:loop	dey
				bne :loop
		`;
		expect(assemble(source)).toEqual([0xca, 0xd0, 0xfd, 0x88, 0xd0, 0xfd]);
	});

	describe("given to the assembler", () => {
		it("are the options each pass starts with", () => {
			const source = `
				start:
				@loop	dex
					bne @loop
				!	bne !-
			`;
			expect(assemble(source, {}, { options: { "local.prefix": "@", "anon.marker": "!" } })).toEqual([0xca, 0xd0, 0xfd, 0xd0, 0xfe]);
		});

		it("are the options each assembly starts with", () => {
			const assembler = setup({}, { options: { "local.prefix": "@" } });
			assembler.assemble(`
				start:
					.option local.prefix ":"
				:loop	dex
			`);
			assembler.assemble(`
				start:
				@loop	dex
					bne @loop
			`);
			expect(assembler.link()).toEqual([0xca, 0xd0, 0xfd]);
		});

		it("rejects an unknown option", () => {
			expect(() => setup({}, { options: { local_label_char: "@" } as AssemblerOptions["options"] })).toThrow("Unknown option 'local_label_char'.");
		});

		it("rejects a char that can't be a label prefix", () => {
			expect(() => setup({}, { options: { "anon.marker": "." } })).toThrow("'anon.marker' must be one of ':', '@', '!', '?', '_', '~'.");
		});
	});

	describe("messages name a local label as written, with its prefix", () => {
		const options: AssemblerOptions = { options: { "local.prefix": "@" } };

		it("defined without a global label", () => {
			const source = `
				@loop	nop
			`;
			expect(() => assemble(source, {}, options)).toThrow("Local label '@loop' defined without a preceding global label.");
		});

		it("used without a global label", () => {
			const source = `
					lda @loop
			`;
			expect(() => assemble(source, {}, options)).toThrow("Local label reference '@loop' used without a preceding global label.");
		});

		it("undefined", () => {
			const source = `
				start:
					lda @nope
			`;
			expect(() => assemble(source, {}, options)).toThrow("Undefined local label '@nope' in scope 'START'.");
		});

		it("moved between the passes", () => {
			const source = `
				main:
					lda zp
				@done	rts
				zp = $10
			`;
			expect(() => assemble(source, {}, options)).toThrow("Phase error: local label '@done' of 'MAIN'");
		});
	});
});
