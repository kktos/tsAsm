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
	endianness: "little" as const,
	addressBits: 16,
};

describe("Function STR()", () => {
	const setup = () => {
		const assembler = new Assembler(fakeCPU, new MockFileHandler());
		const { symbolTable, expressionEvaluator: evaluator } = assembler;
		const tokenize = (expr: string) => assembler.parser.lexer.tokenize(expr).filter((t) => t.type !== "EOF");
		const evaluate = (expr: string) => evaluator.evaluate(tokenize(expr), { PC: { value: 0 } });
		return { symbolTable, evaluate };
	};

	it("writes a number in decimal", () => {
		const { evaluate } = setup();
		expect(evaluate(".STR(42)")).toBe("42");
		expect(evaluate(".STR(-7)")).toBe("-7");
	});

	it("writes a number in the radix given, its digits over 9 in upper case", () => {
		const { evaluate } = setup();
		expect(evaluate(".STR(255, 16)")).toBe("FF");
		expect(evaluate(".STR(5, 2)")).toBe("101");
		expect(evaluate(".STR(35, 36)")).toBe("Z");
		expect(evaluate(".STR(-255, 16)")).toBe("-FF");
	});

	it("gives a string as is", () => {
		const { evaluate, symbolTable } = setup();
		expect(evaluate('.STR("AB")')).toBe("AB");
		symbolTable.defineVariable("name", "INTRO", { filename: "test", line: 1, column: 1 });
		expect(evaluate('"region" + .STR(name)')).toBe("regionINTRO");
	});

	it("fails on an array or an object, pointing to .JSON()", () => {
		const { evaluate } = setup();
		expect(() => evaluate(".STR([1, 2])")).toThrow("First argument to .STR() must be a number or a string: .JSON() writes an array or an object.");
	});

	it("fails on a radix that isn't an integer from 2 to 36, or given for a string", () => {
		const { evaluate } = setup();
		for (const radix of ["1", "37", "5/2", '"16"'])
			expect(() => evaluate(`.STR(10, ${radix})`)).toThrow("Second argument to .STR() (radix) must be an integer from 2 to 36.");
		expect(() => evaluate('.STR("AB", 16)')).toThrow("A radix writes a number: .STR() gives a string as is.");
	});

	it("fails on a third argument", () => {
		const { evaluate } = setup();
		expect(() => evaluate(".STR(1, 2, 3)")).toThrow("Function 'STR' expects between 1 and 2 arguments, but got 3.");
	});
});
