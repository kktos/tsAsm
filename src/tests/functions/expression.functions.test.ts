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

describe("ExpressionEvaluator", () => {
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

	describe("Functions", () => {
		it("should evaluate .DEF() on a defined symbol", () => {
			const { evaluator, tokenize, symbolTable } = setup();
			symbolTable.assignVariable("MySymbol", 123);
			const tokens = tokenize(".DEF(MySymbol)");
			const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
			expect(result).toBe(1);
		});

		it("should evaluate .DEF() on an undefined symbol", () => {
			const { evaluator, tokenize } = setup();
			const tokens = tokenize('.DEF("MySymbol")');
			const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
			expect(result).toBe(0);
		});

		it.skip("should evaluate .UNDEF() on an undefined symbol", () => {
			const { evaluator, tokenize } = setup();
			const tokens = tokenize(".UNDEF(Unknown)");
			const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
			expect(result).toBe(1);
		});

		it("should evaluate .HEX() with one argument", () => {
			const { evaluator, tokenize } = setup();
			const tokens = tokenize(".HEX(255)");
			const result = evaluator.evaluate(tokens, { PC: { value: 0 } });
			expect(result).toBe("$FF");
		});

		it("should evaluate .HEX() with padding", () => {
			const { evaluator, tokenize } = setup();
			const tokens = tokenize(".HEX(42, 4)");
			const result = evaluator.evaluate(tokens, { PC: { value: 0 } });
			expect(result).toBe("$002A");
		});

		it("should evaluate .LOBYTE() to get the low byte of a 16-bit value", () => {
			const { evaluator, tokenize } = setup();
			let tokens = tokenize(".LOBYTE($1234)");
			let result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
			expect(result).toBe(0x34);
			tokens = tokenize(".LOBYTE($22)");
			result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
			expect(result).toBe(0x22);
		});

		it("should evaluate .HIBYTE() to get the high byte of a 16-bit value", () => {
			const { evaluator, tokenize } = setup();
			let tokens = tokenize(".HIBYTE($1234)");
			let result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
			expect(result).toBe(0x12);
			tokens = tokenize(".HIBYTE($34)");
			result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
			expect(result).toBe(0x00);
		});
	});
});
