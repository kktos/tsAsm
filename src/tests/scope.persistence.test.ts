import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
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
	getPCSize: () => 8,
};

describe("Scope Persistence", () => {
	it("should persist variable defined with .LET in a loop to the parent scope", () => {
		const assembler = new Assembler(fakeCPU, new MockFileHandler());
		const source = `
            .for i of [1, 2, 3] {
                .let last = i
            }
        `;
		assembler.assemble(source);
		expect(assembler.symbolTable.lookupSymbol("last")).toBe(3);
	});

	it("should persist variable defined with .LET in a macro to the parent scope", () => {
		const assembler = new Assembler(fakeCPU, new MockFileHandler());
		const source = `
            .macro set_var val
                .let myVar = val
            .end
            set_var 42
        `;
		assembler.assemble(source);
		expect(assembler.symbolTable.lookupSymbol("myVar")).toBe(42);
	});

	it("should NOT persist variable defined with .LET in a function to the global scope", () => {
		const assembler = new Assembler(fakeCPU, new MockFileHandler());
		const source = `
            .function myFunc {
                .let internal = 10
            }
        `;
		assembler.assemble(source);
		expect(assembler.symbolTable.lookupSymbol("internal")).toBeUndefined();
	});

	it("should persist variable defined with .LET in a loop INSIDE a function to the function scope", () => {
		const assembler = new Assembler(fakeCPU, new MockFileHandler());
		const source = `
            .function myFunc {
                .for i of [1] {
                    .let funcVar = 99
                }
                .db funcVar ; usage to ensure it exists in function scope
            }
        `;
		assembler.assemble(source);
		// It should NOT be in global scope
		expect(assembler.symbolTable.lookupSymbol("funcVar")).toBeUndefined();
	});
});
