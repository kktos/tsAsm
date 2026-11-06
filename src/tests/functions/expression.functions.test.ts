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

describe("ExpressionEvaluator", () => {
	const setup = () => {
		const assembler = new Assembler(fakeCPU, new MockFileHandler());
		const { symbolTable, expressionEvaluator: evaluator } = assembler;
		const lexer = assembler.parser.lexer;
		const tokenize = (expr: string) => lexer.tokenize(expr).filter((t) => t.type !== "EOF");
		return { assembler, symbolTable, evaluator, lexer, tokenize };
	};

	describe("Functions", () => {
		it("should evaluate .DEF() on a defined symbol", () => {
			const { evaluator, tokenize, symbolTable } = setup();
			symbolTable.defineVariable("MySymbol", 123, { filename: "test", line: 1, column: 1 });
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

		it("should evaluate .UNDEF() on an undefined symbol", () => {
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

		it.each([
			["$FFFF", "$FFFF"],
			["$10000", "$010000"],
			["$123456", "$123456"],
			["$1000000", "$01000000"],
		])("should evaluate .HEX() on as many digits as the bytes holding it: .HEX(%s)", (args, expected) => {
			const { evaluator, tokenize } = setup();
			const result = evaluator.evaluate(tokenize(`.HEX(${args})`), { PC: { value: 0 } });
			expect(result).toBe(expected);
		});

		it.each([
			["-1", "$FF"],
			["-128", "$80"],
			["-129", "$FF7F"],
			["-200", "$FF38"],
			["-32768", "$8000"],
			["-70000", "$FEEE90"],
			["-8388608", "$800000"],
			["-8388609", "$FF7FFFFF"],
			["-1, 4", "$FFFF"],
			["-129, 2", "$F7F"],
		])("should evaluate .HEX() of a negative value as two's complement: .HEX(%s)", (args, expected) => {
			const { evaluator, tokenize } = setup();
			const result = evaluator.evaluate(tokenize(`.HEX(${args})`), { PC: { value: 0 } });
			expect(result).toBe(expected);
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

		it.each([
			[".BANKBYTE($123456)", 0x12],
			[".BANKBYTE($12345678)", 0x34],
			[".BANKBYTE($1234)", 0x00],
			[".BKBYTE($123456)", 0x12],
		])("should evaluate %s to get the bank byte of a 24-bit value", (expr, expected) => {
			const { evaluator, tokenize } = setup();
			expect(evaluator.evaluateAsNumber(tokenize(expr), { PC: { value: 0 } })).toBe(expected);
		});

		it.each([
			['.BANKBYTE("AB")', ".BANKBYTE() requires a number argument."],
			['.BKBYTE("AB")', ".BKBYTE() requires a number argument."],
			['.LOBYTE("AB")', ".LOBYTE() requires a number argument."],
			['.FLOOR("")', ".FLOOR() requires a number argument."],
		])("should reject a string that isn't one character: %s", (expr, message) => {
			const { evaluator, tokenize } = setup();
			expect(() => evaluator.evaluate(tokenize(expr), { PC: { value: 0 } })).toThrow(message);
		});

		// A one-character string used as a number is its character code, wherever a number is expected.
		it.each([
			['.LOBYTE("A")', 0x41],
			['.HIBYTE("A")', 0],
			['.BANKBYTE("A")', 0],
			['.BKBYTE("A")', 0],
			['.FLOOR("A")', 0x41],
			['.CEIL("A")', 0x41],
			['.ROUND("A")', 0x41],
			['.HEX("A")', "$41"],
			['.HEX(1, "\\x04")', "$0001"],
			['.PAD(1, "\\x03")', "  1"],
			['.STR(255, "\\x10")', "FF"],
		])("should take a one-character string as its character code: %s", (expr, expected) => {
			const { evaluator, tokenize } = setup();
			expect(evaluator.evaluate(tokenize(expr), { PC: { value: 0 } })).toBe(expected);
		});

		it("should keep a string where text is taken: .PAD()'s value and fill, .STR()'s value", () => {
			const { evaluator, tokenize } = setup();
			expect(evaluator.evaluate(tokenize('.PAD("A", 3, "0")'), { PC: { value: 0 } })).toBe("00A");
			expect(evaluator.evaluate(tokenize('.STR("A")'), { PC: { value: 0 } })).toBe("A");
		});
	});

	describe("Arguments defined later (pass 1)", () => {
		it.each([
			".LEN(Later)",
			".STR(Later)",
			".HEX(Later)",
			".SPLIT(Later)",
			".POP(Later)",
			'.JOIN(Later, ",")',
			".TYPE(Later)",
			".JSON(Later)",
			".FLOOR(Later)",
			".IIF(Later, 1, 2)",
			".PUSH(Later, 1)",
			".LEN(.STR(Later))",
		])("should give null (not known yet): %s", (expr) => {
			const { evaluator, tokenize } = setup();
			const result = evaluator.evaluate(tokenize(expr), { PC: { value: 0 }, allowForwardRef: true });
			expect(result).toBe(null);
		});

		it.each([
			[".IIF(1, 2, Later)", 2],
			[".LEN(.ARRAY(1, Later))", 2],
			[".LEN(.PUSH([1], Later))", 2],
			[".DEF(Later)", 0],
		])("should still compute what the unknown argument doesn't change: %s", (expr, expected) => {
			const { evaluator, tokenize } = setup();
			const result = evaluator.evaluate(tokenize(expr), { PC: { value: 0 }, allowForwardRef: true });
			expect(result).toBe(expected);
		});

		it("should still check the arguments that are known", () => {
			const { evaluator, tokenize } = setup();
			expect(() => evaluator.evaluate(tokenize(".LEN(5)"), { PC: { value: 0 }, allowForwardRef: true })).toThrow(
				".LEN() requires a string or array argument.",
			);
		});

		it("should assemble with symbols defined after the functions using them", () => {
			const { assembler } = setup();
			const src = `
				.db .len(msg), .iif(flag, 1, 2), .len(.split(list, ","))
				msg = "bc"
				flag = 0
				list = "a,b,c"
			`;
			assembler.assemble(src);
			expect(assembler.link()).toEqual([2, 2, 3]);
		});
	});
});
