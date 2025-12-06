import { describe, expect, it, vi } from "vitest";
import type { DirectiveContext } from "../directives/directive.interface";
import { Assembler } from "../polyasm";
import type { FileHandler, SegmentDefinition } from "../polyasm.types";
import type { SymbolValue } from "../symbol.class";

class MockFileHandler implements FileHandler {
	fullpath = "";
	readSourceFile(filename: string): string {
		throw new Error(`Mock file not found: "${filename}"`);
	}
	readBinaryFile(filename: string): number[] {
		throw new Error(`Mock bin file not found: ${filename}`);
	}
}

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

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe(".DEFINE Directive", () => {
	const createAssembler = (
		defineSymbolHandlers: { default: string; map: Map<string, (blockContent: string, context: DirectiveContext) => SymbolValue> },
		segments: SegmentDefinition[] = DEFAULT_SEGMENTS,
	) => {
		const mockFileHandler = new MockFileHandler();
		return new Assembler(fakeCPU, mockFileHandler, { segments, rawDataProcessors: defineSymbolHandlers });
	};

	it("should call the external handler and define the symbol", () => {
		// 1. Create a mock handler function
		const textHandler = vi.fn((blockContent: string, _context: DirectiveContext) => blockContent);
		const handlers = { default: "text", map: new Map([["text", textHandler]]) };

		// 2. Create assembler with the handler
		const assembler = createAssembler(handlers);

		// 3. Assemble source with the .DEFINE directive
		const source = `
            .DEFINE MY_SYMBOL
                This is some complex data
                that the handler will process.
            .END
        `;
		assembler.assemble(source);

		// 5. Verify the symbol was defined with the handler's return value
		const symbolValue = assembler.symbolTable.lookupSymbol("MY_SYMBOL");
		expect(symbolValue).toBe(`                This is some complex data
                that the handler will process.`);
	});

	it("should throw an error for a duplicate symbol definition", () => {
		// 1. Create a mock handler function
		const textHandler = vi.fn((blockContent: string, _context: DirectiveContext) => blockContent);
		const handlers = { default: "text", map: new Map([["text", textHandler]]) };

		const assembler = createAssembler(handlers);
		const source = `
			.DEFINE MY_SYMBOL
			.END
			.DEFINE MY_SYMBOL
			.END
		`;
		expect(() => assembler.assemble(source)).toThrow("ERROR: PASymbol global::MY_SYMBOL redefined.");
	});

	it("should throw an error for an unknown handler", () => {
		// 1. Create a mock handler function
		const textHandler = vi.fn((blockContent: string, _context: DirectiveContext) => blockContent);
		const handlers = { default: "text", map: new Map([["text", textHandler]]) };

		const assembler = createAssembler(handlers);
		const source = `
			.DEFINE MY_SYMBOL AS TOML
			.END
		`;
		expect(() => assembler.assemble(source)).toThrow("'.DEFINE' directive on line 2; unknown Data Processor 'TOML'.");
	});

	it("should return a text with a TEXT processor", () => {
		const textHandler = vi.fn((blockContent: string, _context: DirectiveContext) => blockContent);
		const handlers = { default: "TEXT", map: new Map([["TEXT", textHandler]]) };
		const assembler = createAssembler(handlers);

		const source = `
			.DEFINE MY_SYMBOL AS TEXT
			toto
			.END
		`;
		assembler.assemble(source);

		const symbolValue = assembler.symbolTable.lookupSymbol("MY_SYMBOL");
		expect(symbolValue?.toString().trim()).toBe("toto");
	});

	it("should return an object with a JSON processor", () => {
		const jsonHandler = vi.fn((blockContent: string, _context: DirectiveContext) => JSON.parse(blockContent));
		const handlers = { default: "JSON", map: new Map([["JSON", jsonHandler]]) };
		const assembler = createAssembler(handlers);

		const source = `
			.DEFINE MY_SYMBOL AS JSON
			{
				"name": "tata"
			}
			.END
		`;
		assembler.assemble(source);

		const symbolValue = assembler.symbolTable.lookupSymbol("MY_SYMBOL");
		expect(symbolValue).toEqual({ name: "tata" });
	});

	it("should return an object with a JSON processor", () => {
		const jsonHandler = vi.fn((blockContent: string, _context: DirectiveContext) => JSON.parse(blockContent));
		const handlers = { default: "JSON", map: new Map([["JSON", jsonHandler]]) };
		const assembler = createAssembler(handlers);

		const source = `
			.DEFINE list AS JSON
			{
				"count": 16
			}
			.END
			.db list.count
		`;
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([16]);
	});

	it("should return a plain text", () => {
		const textHandler = vi.fn((blockContent: string, _context: DirectiveContext) => blockContent);
		const handlers = { default: "TEXT", map: new Map([["TEXT", textHandler]]) };
		const assembler = createAssembler(handlers);

		const source = `
			.define spriteList
			- { id: $55, x: $0d, y: $30, name:"text key"}
			- { id: $27, x: 15, y: 60, name:"img key"}
			- { id: $57, x: $31, y: $27, name:"text locked door"}
			- { id: $5C, x: $3A, y: $3C, name:"img locked door"}
			- { id: $58, x: $59, y: $27, name:"text unlocked door"}
			- { id: $5d, x: $67, y: $3C, name:"img unlocked door"}
			- { id: $59, x: $25, y: $64, name:"text gem"}
			- { id: $28, x: $28, y: $6e, name:"img gem"}
			- { id: $5a, x: $53, y: $5b, name:"text gem holder"}
			- { id: $56, x: $5b, y: $6d, name:"img gem holder"}
			- { id: $5b, x: $2e, y: $88, name:"text extra sword"}
			- { id: $1e, x: $40, y: $9b, name:"img extra sword"}
			.end
		`;
		assembler.assemble(source);

		expect(assembler.symbolTable.lookupSymbol("spriteList")).toBeTypeOf("string");
	});
});
