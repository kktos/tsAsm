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

describe("Function IIF()", () => {
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

	it("should evaluate .IIF() to return the true value based on the condition", () => {
		const { evaluator, tokenize } = setup();

		const tokens = tokenize('.IIF(1!=0, "true", "false")');
		const result = evaluator.evaluate(tokens, { PC: { value: 0 } });
		expect(result).toBe("true");
	});

	it("should evaluate .IIF() to return the false value based on the condition", () => {
		const { evaluator, tokenize } = setup();

		const tokens = tokenize('.IIF(1==0, "true", "false")');
		const result = evaluator.evaluate(tokens, { PC: { value: 0 } });
		expect(result).toBe("false");
	});

	it("should fail if condition is not a number", () => {
		const { evaluator, tokenize } = setup();

		const tokens = tokenize('.IIF("toto", "true", "false")');
		expect(() => evaluator.evaluate(tokens, { PC: { value: 0 } })).toThrow("First argument to .IIF() must be a number on line 1.");
	});
});
