import { beforeEach, describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { MockFileHandler } from "./mockfilehandler.class";

// Minimal fake CPU handler
const fakeCPU = {
	cpuType: "6502" as const,
	isInstruction: () => false,
	resolveAddressingMode: () => ({
		mode: "",
		opcode: 0,
		bytes: 0,
		resolvedAddress: 0,
	}),
	encodeInstruction: () => [],
	getPCSize: () => 8,
};

describe(".EQU - constant assignment", () => {
	let asm: Assembler;

	beforeEach(() => {
		asm = asm = new Assembler(fakeCPU, new MockFileHandler());
	});

	it("should define a constant", () => {
		const src = "foo .EQU 123";
		asm.assemble(src);
		const symbol = asm.symbolTable.lookupSymbol("foo");
		expect(symbol).toBe(123);
	});

	it("should forbid to change its value", () => {
		const src = `
				foo .EQU 123
				foo .EQU 456
			`;
		expect(() => asm.assemble(src)).toThrow(/global::FOO redefined/);
	});

	it("should have a mandatory symbol name before .EQU", () => {
		const src = `
				foo .EQU 123
				.EQU 456
			`;
		expect(() => asm.assemble(src)).toThrow(/Missing symbol name before .EQU/);
	});

	it("should reset the lastGlobalLabel after each assignment", () => {
		const src = `
				boo .EQU 123
				foo .EQU boo
				.EQU 456
			`;
		expect(() => asm.assemble(src)).toThrow(/Missing symbol name before .EQU/);
	});

	it("should have a mandatory symbol name before .EQU on the same line", () => {
		const src = `
				hello .EQU 456
				boo:
					.echo hello

					.EQU 456
			`;
		expect(() => asm.assemble(src)).toThrow(/Missing symbol name before .EQU/);
	});

	it("should not work with label", () => {
		const src = `
				boo:
					.EQU 456
			`;
		expect(() => asm.assemble(src)).toThrow(/Missing symbol name before .EQU/);
	});

	it("should not work with special label *", () => {
		const src = `
				*	.EQU 456
			`;
		expect(() => asm.assemble(src)).toThrow(/Missing symbol name before .EQU/);
	});
});
