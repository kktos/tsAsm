import { beforeEach, describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";

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

describe("Directive .EXPORT", () => {
	let asm: Assembler;

	beforeEach(() => {
		asm = asm = new Assembler(fakeCPU, { fullpath: "", readSourceFile: () => "", readBinaryFile: () => [] });
	});

	it("should export a constant", () => {
		const src = `
			.namespace world
			foo .EQU 155
			.export foo
			.end namespace
		`;
		asm.assemble(src);
		let symbolName = asm.symbolTable.lookupSymbol("foo");
		expect(symbolName).toBe(155);
		symbolName = asm.symbolTable.lookupSymbol("world::foo");
		expect(symbolName).toBe(155);
	});

	it("should not export a variable", () => {
		const src = `
			.namespace world
			foo = 155
			.export foo
			.end namespace
		`;
		expect(() => asm.assemble(src)).toThrow(/Can't export variable symbol FOO/);
	});

	it("should not export that will override an existing constant", () => {
		const src = `
			foo .EQU 155
			.namespace world
			foo .EQU 54
			.export foo
			.end namespace
		`;
		expect(() => asm.assemble(src)).toThrow(/Can't export variable symbol FOO - PASymbol global::FOO redefined./);
	});
});
