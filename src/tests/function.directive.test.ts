import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

const newAssembler = () =>
	new Assembler(new Cpu6502Handler(), new MockFileHandler(), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });

const assemble = (source: string) => {
	const asm = newAssembler();
	asm.assemble(source);
	return asm.link();
};

/** The error assembling `source` throws, at `line` and `column`. */
const errorAt = (message: string, line: number, column?: number) =>
	expect.objectContaining({ message, location: expect.objectContaining(column === undefined ? { line } : { line, column }) });

describe("Directive: .function, the one-line form", () => {
	describe("a call", () => {
		it("should give the expression's value with the arguments", () => {
			const bytes = assemble(`
				.function screen(col, row) = $0400 + row*40 + col
				sta screen(10, 5)
			`);
			expect(bytes).toEqual([0x8d, 0xd2, 0x04]);
		});

		it("should take no argument", () => {
			const bytes = assemble(`
				.function answer() = 42
				.db answer()
			`);
			expect(bytes).toEqual([42]);
		});

		it("should evaluate the arguments at the call, as values", () => {
			const bytes = assemble(`
				.function double(x) = x * 2
				.db double(1 + 2)
			`);
			expect(bytes).toEqual([6]);
		});

		it("should be written .fn too, in any case", () => {
			const bytes = assemble(`
				.fn inc(x) = x + 1
				.Function dec(x) = x - 1
				.db INC(1), Dec(1)
			`);
			expect(bytes).toEqual([2, 0]);
		});

		it("should call another function, and be an argument", () => {
			const bytes = assemble(`
				.function sq(x) = x * x
				.function sumsq(a, b) = sq(a) + sq(b)
				.db sumsq(1, 2), sq(sq(2))
			`);
			expect(bytes).toEqual([5, 16]);
		});

		it("should work in a loop, a .if and an assignment", () => {
			const bytes = assemble(`
				.function sq(x) = x * x
				.repeat 4 as i from 0
					.db sq(i)
				.end
				.if sq(3) == 9
					v = sq(4)
					.db v
				.end
			`);
			expect(bytes).toEqual([0, 1, 4, 9, 16]);
		});

		it("should take a label defined further down", () => {
			const bytes = assemble(`
				.function next(addr) = addr + 1
				jmp next(target)
				nop
			target:
				nop
			`);
			expect(bytes).toEqual([0x4c, 0x05, 0x10, 0xea, 0xea]);
		});

		it("should take strings and arrays", () => {
			const bytes = assemble(`
				.function second(a) = a[1]
				.function twice(s) = s + s
				.db second([7, 8, 9])
				.text twice("ab")
			`);
			expect(bytes).toEqual([8, 0x61, 0x62, 0x61, 0x62]);
		});
	});

	describe("its scope", () => {
		it("should read the symbols and * at the call", () => {
			const bytes = assemble(`
				base = 10
				.function here(n) = * + base + n
				.dw here(1)
				base = 20
				.dw here(1)
			`);
			expect(bytes).toEqual([0x0b, 0x10, 0x17, 0x10]);
		});

		it("should keep its parameters local: an outer symbol of the same name is hidden in the body and kept", () => {
			const bytes = assemble(`
				x = 5
				.function f(x) = x * 2
				.db f(1), x
			`);
			expect(bytes).toEqual([2, 5]);
		});

		it("should not define its parameters outside", () => {
			expect(() =>
				assemble(`
				.function f(param) = param
				.db f(1)
				.db param
			`),
			).toThrow("Undefined symbol 'PARAM'.");
		});

		it("should read the symbols of where it's defined, not the caller's macro parameters and variables", () => {
			const bytes = assemble(`
				x = 1
				.function f() = x
				.macro m x
					.db f()
				.end
				.macro n
					x = 9
					.db f()
				.end
				m 7
				n
			`);
			expect(bytes).toEqual([1, 1]);
		});

		it("should read the symbols of its namespace, and be called with it from another", () => {
			const bytes = assemble(`
				.namespace gfx
				base = $20
				.function line(n) = base + n
				.db line(1)
				.namespace global
				.db gfx::line(2)
			`);
			expect(bytes).toEqual([0x21, 0x22]);
		});

		it("should be defined once by its line in a block not assembled, without taking the block's .end", () => {
			const bytes = assemble(`
				.if 0
					.function f(x) = x
				.end
				.macro m
					.function g(x) = x + 1
					.db g(1)
				.end
				m
			`);
			expect(bytes).toEqual([2]);
		});
	});

	describe("errors", () => {
		it.each([
			["a function that doesn't exist", "lda nope(1)", "Unknown function 'nope'."],
			["a symbol that isn't a function", "x = 1\n lda x(1)", "'x' isn't a function."],
			["too few arguments", ".function f(a, b) = a + b\n lda f(1)", "Function 'f' expects 2 arguments, but got 1."],
			["too many arguments", ".function f(a) = a\n lda f(1, 2)", "Function 'f' expects 1 argument, but got 2."],
			["a function's name as a value", ".function f(a) = a\n lda f", "'f' is a function: call it, f(…)."],
			["a space before the (", ".function f(a) = a\n lda f (1)", "'f' is a function: call it, f(…)."],
		])("should report %s", (_, source, message) => {
			expect(() => assemble(source)).toThrow(message);
		});

		it("should report a call before the definition", () => {
			expect(() =>
				assemble(`
				.db f(1)
				.function f(x) = x
			`),
			).toThrow(errorAt("Unknown function 'f'.", 2, 9));
		});

		it("should report it in pass 2 too, which has the definition pass 1 read further down", () => {
			expect(() =>
				assemble(`
				.if .pass == 2
					.db f(1)
				.end
				.function f(x) = x
			`),
			).toThrow(errorAt("Unknown function 'f'.", 3, 10));
		});

		it.each([
			["a symbol, then a function", "f = 1\n.function f(x) = x"],
			["a function, then a symbol", ".function f(x) = x\nf = 1"],
			["a label, then a function", "f: nop\n.function f(x) = x"],
			["a function twice", ".function f(x) = x\n.function f(y) = y"],
			["a function in a loop, which generates its line at each iteration", ".repeat 2\n.function f(x) = x\n.end"],
		])("should report a name defined as %s", (_, source) => {
			expect(() => assemble(source)).toThrow(/^(Symbol 'F' redefined\.|Can't redefine constant 'F'\.)$/);
		});

		it.each([
			[".function f(1) = 1", "A parameter of function 'f' must be a name."],
			[".function f(a,) = a", "A parameter of function 'f' must be a name."],
			[".function f(a, a) = a", "Parameter 'a' of function 'f' is given twice."],
			[".function f(a b) = a", "Missing ')' after the parameters of function 'f'."],
			[".function f(a", "Missing ')' after the parameters of function 'f'."],
			[".function f(a)", "Missing '=' and the expression of function 'f'."],
			[".function f(a) a", "Missing '=' and the expression of function 'f'."],
			[".function f(a) =", "Missing the expression of function 'f' after '='."],
			[".function f(a) {\n.return a\n}", "A function's body is one expression for now: write .FUNCTION f(…) = <expression>."],
		])("should report a wrong definition: %s", (source, message) => {
			expect(() => assemble(source)).toThrow(message);
		});

		it("should locate an error in the body at the call, with a note at the function", () => {
			expect(() =>
				assemble(`
				.function f(x) = x / 0
				nop
				.db f(1)
			`),
			).toThrow(
				expect.objectContaining({
					message: "Division by zero.",
					location: expect.objectContaining({ line: 4, column: 9 }),
					notes: [expect.objectContaining({ message: "in function f, defined here", location: expect.objectContaining({ line: 2 }) })],
				}),
			);
		});

		it("should note only the function the error is in, called from another", () => {
			expect(() =>
				assemble(`
				.function inner(x) = nope + x
				.function outer(x) = inner(x)
				.db outer(1)
			`),
			).toThrow(
				expect.objectContaining({
					message: "Undefined symbol 'NOPE'.",
					location: expect.objectContaining({ line: 4, column: 9 }),
					notes: [expect.objectContaining({ message: "in function inner, defined here", location: expect.objectContaining({ line: 2 }) })],
				}),
			);
		});
	});

	describe("recursion, limited by .option function.recursion", () => {
		it("should be an error past 64 calls by default", () => {
			expect(() =>
				assemble(`
				.function f(n) = f(n + 1)
				.db f(0)
			`),
			).toThrow(
				expect.objectContaining({
					message: "Function 'f' calls itself more than 64 deep (.option function.recursion).",
					location: expect.objectContaining({ line: 3 }),
					notes: [expect.objectContaining({ message: "in function f, defined here" })],
				}),
			);
		});

		it("should count a function calling itself through another", () => {
			expect(() =>
				assemble(`
				.option function.recursion 3
				.function ping(n) = pong(n)
				.function pong(n) = ping(n)
				.db ping(0)
			`),
			).toThrow("Function 'ping' calls itself more than 3 deep (.option function.recursion).");
		});

		it("should forbid any with 0", () => {
			expect(() =>
				assemble(`
				.option function.recursion 0
				.function f(n) = f(n)
				.db f(0)
			`),
			).toThrow("Function 'f' calls itself, and .option function.recursion is 0.");
		});

		it("should not count calls of other functions, nor calls one after the other", () => {
			const bytes = assemble(`
				.option function.recursion 0
				.function inc(x) = x + 1
				.function add2(x) = inc(inc(x))
				.db add2(add2(1)), inc(1) + inc(2)
			`);
			expect(bytes).toEqual([5, 5]);
		});

		it.each([["-1"], ["257"], ["3 / 2"], ['"64"']])("should be a whole number from 0 to 256: %s", (value) => {
			expect(() => assemble(`.option function.recursion ${value}`)).toThrow("'function.recursion' must be a whole number from 0 to 256.");
		});
	});

	it("should leave functions out of the symbol file", () => {
		const asm = newAssembler();
		asm.assemble(`
			v = 1
			.function f(x) = x
		`);
		expect(Object.keys(asm.symbolTable.getDict().global ?? {})).toEqual(["V"]);
	});
});
