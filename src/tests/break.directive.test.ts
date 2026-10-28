import { describe, expect, it, vi } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Directive: .break", () => {
	const assemble = (source: string, files: Record<string, string> = {}) => {
		const fileHandler = new MockFileHandler();
		vi.spyOn(fileHandler, "readSourceFile").mockImplementation(function (this: MockFileHandler, name: string) {
			const text = files[name];
			if (text === undefined) throw new Error(`Mock file not found: "${name}"`);
			this.fullpath = name;
			return text;
		});
		const asm = new Assembler(new Cpu6502Handler(), fileHandler, { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
		asm.assemble(source);
		return asm.link();
	};

	it("should end a .repeat, with its iterations left", () => {
		const bytes = assemble(`
			.repeat 10 as i from 0
				.if i == 3
					.break
				.end
				.db i
			.end
			.db $ff
		`);
		expect(bytes).toEqual([0, 1, 2, 0xff]);
	});

	it("should end a .for, and put its iterators back", () => {
		const bytes = assemble(`
			v = 7
			n = 8
			.for v of [1, 2, 0, 9] as n
				.if v == 0
					.break
				.end
				.db v
			.end
			.db v, n
		`);
		expect(bytes).toEqual([1, 2, 7, 8]);
	});

	it("should be written in any case", () => {
		const bytes = assemble(`
			.repeat 3
				.db 1
				.Break
				.db 2
			.end
		`);
		expect(bytes).toEqual([1]);
	});

	it("should only end the innermost loop", () => {
		const bytes = assemble(`
			.repeat 3 as row from 0
				.repeat 3 as col from 0
					.if col > row
						.break
					.end
					.db row * 16 + col
				.end
				.db $ee
			.end
		`);
		expect(bytes).toEqual([0x00, 0xee, 0x10, 0x11, 0xee, 0x20, 0x21, 0x22, 0xee]);
	});

	it("should end a loop of a macro, the macro going on", () => {
		const bytes = assemble(`
			.macro bytesUntil stop, ...values
				.for v of values
					.if v == stop
						.break
					.end
					.db v
				.end
				.db $ee
			.end

			bytesUntil 0, 1, 2, 0, 9
		`);
		expect(bytes).toEqual([1, 2, 0xee]);
	});

	it("should place what follows in pass 2 where pass 1 did", () => {
		const bytes = assemble(`
			.dw after
			.repeat 5 as i from 0
				.if i == 2
					.break
				.end
				.db i
			.end
		after:
			.dw after
		`);
		expect(bytes).toEqual([0x04, 0x10, 0, 1, 0x04, 0x10]);
	});

	it("should not assemble the rest of the body", () => {
		const bytes = assemble(`
			.repeat 2
				.break
				.error "never"
			.end
			.db 1
		`);
		expect(bytes).toEqual([1]);
	});

	it("should check the directives of the rest of the body", () => {
		const source = `
			.repeat 2
				.if 1
					.break
					.db 1
				.end
				.foobar
			.end
		`;
		expect(() => assemble(source)).toThrow("Syntax error - Unexpected directive 'FOOBAR'");
	});

	it("should reject it at the top level", () => {
		expect(() => assemble(".break")).toThrow("Unexpected directive '.BREAK': it isn't in a loop.");
	});

	it("should reject it in a .proc out of a loop", () => {
		const source = `
			.proc p
				.break
			.end
		`;
		expect(() => assemble(source)).toThrow("Unexpected directive '.BREAK': it isn't in a loop.");
	});

	it("should reject it in a macro called from a loop: the macro only sees its own loops", () => {
		const source = `
			.macro m
				.break
			.end
			.repeat 2
				m
			.end
		`;
		expect(() => assemble(source)).toThrow("Unexpected directive '.BREAK': it isn't in a loop of the macro 'M'.");
	});

	it("should reject it in a file included from a loop", () => {
		const source = `
			.repeat 2
				.include "break.asm"
			.end
		`;
		expect(() => assemble(source, { "break.asm": ".db 1\n.break\n" })).toThrow("Unexpected directive '.BREAK': it isn't in a loop of the included file.");
	});

	it("should reject anything after it on its line", () => {
		const source = `
			.repeat 2
				.break 1
			.end
		`;
		expect(() => assemble(source)).toThrow("Unexpected '1' after .BREAK.");
	});
});
