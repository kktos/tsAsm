import { beforeEach, describe, expect, it } from "vitest";
import { Assembler } from "../../assembler/polyasm";
import { NodeFileHandler } from "../../cli/file";

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

describe("Linker Script: .FOR loop", () => {
	let assembler: Assembler;

	beforeEach(() => {
		const fileHandler = new NodeFileHandler();
		assembler = new Assembler(fakeCPU, fileHandler);
	});

	it("should not make local global variables", () => {
		const source = `
			segOffsets = []
			.FOR seg OF segments as idx
				segOffsets = .PUSH(segOffsets,.pc)
			.END
			`;
		assembler.symbolTable.defineVariable("segments", [1, 2, 3]);
		assembler.assemble(source);
		const segOffsets = assembler.symbolTable.lookupSymbol("segOffsets");
		expect(segOffsets).toEqual([4096, 4096, 4096]);
	});
});
