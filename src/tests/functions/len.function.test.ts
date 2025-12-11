import { describe, expect, it } from "vitest";
import { Assembler } from "../../assembler/polyasm";
import type { FileHandler } from "../../assembler/polyasm.types";

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

describe("Function LEN()", () => {
	const setup = () => {
		class MockFileHandler implements FileHandler {
			fullpath = "";
			readSourceFile(filename: string): string {
				throw new Error(`Mock file not found: "${filename}"`);
			}
			readBinaryFile(filename: string): number[] {
				throw new Error(`Mock bin file not found: ${filename}`);
			}
		}
		const assembler = new Assembler(fakeCPU, new MockFileHandler());
		const { symbolTable, expressionEvaluator: evaluator } = assembler;
		const lexer = assembler.parser.lexer;
		const tokenize = (expr: string) => lexer.tokenize(expr).filter((t) => t.type !== "EOF");
		return { assembler, symbolTable, evaluator, lexer, tokenize };
	};

	it("should evaluate .LEN() on a string literal", () => {
		const { evaluator, tokenize } = setup();
		const tokens = tokenize('.LEN("hello")');
		const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
		expect(result).toBe(5);
	});

	it("should evaluate .LEN() on a string symbol", () => {
		const { evaluator, tokenize, symbolTable } = setup();
		symbolTable.assignVariable("MyString", "hello");
		const tokens = tokenize(".LEN(MyString)");
		const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
		expect(result).toBe(5);
	});

	it("should evaluate .LEN() on an array literal", () => {
		const { evaluator, tokenize, symbolTable } = setup();
		symbolTable.assignVariable("MyArr", [10, 20, 30]);
		const tokens = tokenize(".LEN([1, 2, 3])");
		const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
		expect(result).toBe(3);
	});

	it("should evaluate .LEN() on an array symbol", () => {
		const { evaluator, tokenize, symbolTable } = setup();
		symbolTable.assignVariable("MyArr", [1, 2, 3, 4]);
		const tokens = tokenize(".LEN(MyArr)");
		const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
		expect(result).toBe(4);
	});

	it("should fail on types other than string and array", () => {
		const { evaluator, tokenize, symbolTable } = setup();
		symbolTable.assignVariable("MyObject", { name: "" });
		const tokens = tokenize(".LEN(MyObject)");
		expect(() => evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } })).toThrow(/.LEN\(\) requires a string or array argument on line 1./);
	});
});
