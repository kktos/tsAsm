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

describe("= - variable assignment", () => {
	let asm: Assembler;

	beforeEach(() => {
		asm = asm = new Assembler(fakeCPU, new MockFileHandler());
	});

	it("should define a variable", () => {
		const src = "foo = 123";
		asm.assemble(src);
		const symbolName = asm.symbolTable.lookupSymbol("foo");
		expect(symbolName).toBe(123);
	});

	it("should allow to change its value", () => {
		const src = `
				foo = 123
				foo = 456
			`;
		asm.assemble(src);
		const symbolName = asm.symbolTable.lookupSymbol("foo");
		expect(symbolName).toBe(456);
	});

	it("should have a mandatory symbol name before =", () => {
		const src = `
				foo = 123
				= 456
			`;
		expect(() => asm.assemble(src)).toThrow(/Unexpected operator '='/);
	});

	it("should not work with label", () => {
		const src = `
				boo:
					= 456
			`;
		expect(() => asm.assemble(src)).toThrow(/- Missing symbol name before = -/);
	});
});
