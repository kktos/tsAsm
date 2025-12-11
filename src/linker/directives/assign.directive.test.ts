import { beforeEach, describe, expect, it } from "vitest";
import type { Parser } from "../../assembler/parser.class";
import { Assembler } from "../../assembler/polyasm";
import { NodeFileHandler } from "../../cli/file";
import { Linker } from "../linker.class";

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

describe("Linker Script: = - variable assignment", () => {
	let asm: Assembler;
	let linker: Linker;
	let parser: Parser;

	beforeEach(() => {
		const fileHandler = new NodeFileHandler();
		asm = new Assembler(fakeCPU, fileHandler);
		linker = new Linker(asm.logger);
		parser = asm.parser;
	});

	it("should define a variable", () => {
		const src = "foo = 123";
		linker.link(src, parser, asm);
		const symbol = asm.symbolTable.lookupSymbol("foo");
		expect(symbol).toBe(123);
	});

	it("should allow to change its value", () => {
		const src = `
				foo = 123
				foo = 456
			`;
		linker.link(src, parser, asm);
		const symbol = asm.symbolTable.lookupSymbol("foo");
		expect(symbol).toBe(456);
	});

	it.skip("should throw on missing symbol name before =", () => {
		const src = `
				foo = 123
				= 456
			`;
		expect(() => linker.link(src, parser, asm)).toThrow(/Syntax error in line 3 : OPERATOR =/);
	});

	it.skip("should not work with label", () => {
		const src = `
				boo:
					= 456
			`;
		expect(() => linker.link(src, parser, asm)).toThrow(/- Missing symbol name before =/);
	});
});
