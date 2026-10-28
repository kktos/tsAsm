import { describe, expect, it, vi } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Directive: .exitmacro", () => {
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

	it("should end the macro's expansion", () => {
		const bytes = assemble(`
			.macro ldax value
				.if value == 0
					lda #0
					tax
					.exitmacro
				.end
				lda #<value
				ldx #>value
			.end

			ldax 0
			ldax $1234
		`);
		expect(bytes).toEqual([0xa9, 0x00, 0xaa, 0xa9, 0x34, 0xa2, 0x12]);
	});

	it("should be written .exitm, in any case", () => {
		const bytes = assemble(`
			.macro m
				.db 1
				.ExitM
				.db 2
			.end
			m
		`);
		expect(bytes).toEqual([1]);
	});

	it("should end a loop of the macro, all its iterations, and put its iterator back", () => {
		const bytes = assemble(`
			v = 7
			.macro bytesUntil stop, ...values
				.for v of values
					.if v == stop
						.exitmacro
					.end
					.db v
				.end
				.db $ee
			.end

			bytesUntil 0, 1, 2, 0, 9
			.db v
		`);
		expect(bytes).toEqual([1, 2, 7]);
	});

	it("should end a recursive macro", () => {
		const bytes = assemble(`
			.macro down n
				.db n
				.if n == 0
					.exitmacro
				.end
				down n - 1
			.end
			down 3
		`);
		expect(bytes).toEqual([3, 2, 1, 0]);
	});

	it("should only end the innermost macro", () => {
		const bytes = assemble(`
			.macro inner
				.db 1
				.exitmacro
				.db 9
			.end
			.macro outer
				inner
				.db 2
			.end
			outer
			.db 3
		`);
		expect(bytes).toEqual([1, 2, 3]);
	});

	it("should end the macro's scope: each call has its own labels, and pass 2 finds the addresses of pass 1", () => {
		const bytes = assemble(`
			.macro m
			here:
				.db 1
				.exitmacro
				.db 2, 3
			.end
			m
			m
		after:
			.dw after
		`);
		expect(bytes).toEqual([1, 1, 0x02, 0x10]);
	});

	it("should not assemble the rest of the body", () => {
		const bytes = assemble(`
			.macro m
				.exitmacro
				.error "never"
			.end
			m
			.db 1
		`);
		expect(bytes).toEqual([1]);
	});

	it("should check the directives of the rest of the body", () => {
		const source = `
			.macro m
				.if 1
					.exitmacro
					.db 1
				.end
				.foobar
			.end
			m
		`;
		expect(() => assemble(source)).toThrow("Syntax error - Unexpected directive 'FOOBAR'");
	});

	it.each([
		["at the top level", ".exitmacro"],
		["in a loop", ".repeat 2\n.exitmacro\n.end"],
		["in a .proc", ".proc p\n.exitmacro\n.end"],
	])("should reject it %s", (_where, source) => {
		expect(() => assemble(source)).toThrow("Unexpected directive '.EXITMACRO': it isn't in a macro.");
	});

	it("should reject it in a file included from a macro", () => {
		const source = `
			.macro m
				.include "exit.asm"
				.db 2
			.end
			m
		`;
		expect(() => assemble(source, { "exit.asm": ".db 1\n.exitm\n" })).toThrow("Unexpected directive '.EXITM': it isn't in a macro.");
	});

	it("should reject anything after it on its line", () => {
		const source = `
			.macro m
				.exitmacro 1
			.end
			m
		`;
		expect(() => assemble(source)).toThrow("Unexpected '1' after .EXITMACRO.");
	});
});
