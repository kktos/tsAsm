import { describe, expect, it } from "vitest";
import { Assembler } from "../../assembler/polyasm";
import { MockFileHandler } from "../mockfilehandler.class";

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

describe("Function .LABEL()", () => {
	const setup = () => {
		const assembler = new Assembler(fakeCPU, new MockFileHandler());
		const { symbolTable, expressionEvaluator: evaluator } = assembler;
		const lexer = assembler.parser.lexer;
		const tokenize = (expr: string) => lexer.tokenize(expr).filter((t) => t.type !== "EOF");
		return { assembler, symbolTable, evaluator, lexer, tokenize };
	};

	it("should resolve a global label", () => {
		const { evaluator, tokenize, symbolTable } = setup();
		symbolTable.defineVariable("MyLabel", 0x1234, { filename: "test", line: 0, column: 0 });

		const tokens = tokenize('.LABEL("MyLabel")');
		const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
		expect(result).toBe(0x1234);
	});

	it("should resolve a global label constructed dynamically", () => {
		const { evaluator, tokenize, symbolTable } = setup();
		symbolTable.defineVariable("MyLabel_1", 0x100, { filename: "test", line: 0, column: 0 });
		symbolTable.defineVariable("MyLabel_2", 0x200, { filename: "test", line: 0, column: 0 });

		const tokens = tokenize('.LABEL("MyLabel_" + "2")');
		const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } });
		expect(result).toBe(0x200);
	});

	it("should resolve a local label", () => {
		const { evaluator, tokenize, symbolTable } = setup();
		// Define global label
		symbolTable.defineConstant("Global", 0x1000, { filename: "test", line: 0, column: 0 });
		// Define local label Global.Local
		symbolTable.defineConstant("Global.Local", 0x1004, { filename: "test", line: 0, column: 0 });

		const tokens = tokenize('.LABEL("Local")');
		// We must provide currentLabel in context for local label resolution
		const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 }, currentLabel: "Global" });
		expect(result).toBe(0x1004);
	});

	it("should throw if argument is not a string", () => {
		const { evaluator, tokenize } = setup();
		const tokens = tokenize(".LABEL(123)");
		expect(() => evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } })).toThrow(".LABEL() requires a string argument");
	});

	it("should throw if symbol is undefined", () => {
		const { evaluator, tokenize } = setup();
		const tokens = tokenize('.LABEL("Unknown")');
		expect(() => evaluator.evaluateAsNumber(tokens, { PC: { value: 0 } })).toThrow("Undefined symbol 'Unknown'");
	});
});
