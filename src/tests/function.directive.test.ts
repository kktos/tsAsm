import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
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

		it("should read the parameters of the macro whose body defines it, with the arguments of that call", () => {
			const bytes = assemble(`
				.macro m base
					.function f(x) = base + x
					.db f(1)
				.end
				m 5
				m 7
			`);
			expect(bytes).toEqual([6, 8]);
		});

		it("should hide a macro parameter of the same name by its own", () => {
			const bytes = assemble(`
				.macro m x
					.function f(x) = x * 2
					.db f(1), x
				.end
				m 5
			`);
			expect(bytes).toEqual([2, 5]);
		});

		it("should index the macro's rest parameter with its own", () => {
			const bytes = assemble(`
				.macro m ...p
					.function f(i) = p[i]
					.db f(0), f(2)
				.end
				m 1, 2, 3
			`);
			expect(bytes).toEqual([1, 3]);
		});

		it("should read the macro parameters of where it's defined, called from a nested macro with its own", () => {
			const bytes = assemble(`
				.macro inner base
					.db f(1)
				.end
				.macro m base
					.function f(x) = base + x
					inner 100
				.end
				m 5
			`);
			expect(bytes).toEqual([6]);
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
			[".function f(a)", "Missing .END for the .FUNCTION block."],
			[".function f(a) a", "Unexpected 'a' after the parameters of function 'f': write = <expression>, or a body."],
			[".function f(a) =", "Missing the expression of function 'f' after '='."],
		])("should report a wrong definition: %s", (source, message) => {
			expect(() => assemble(source)).toThrow(message);
		});

		it("should locate an error in the expression at the call, with a note at it", () => {
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
					notes: [expect.objectContaining({ message: "in function f", location: expect.objectContaining({ line: 2, column: 24 }) })],
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
					notes: [expect.objectContaining({ message: "in function inner", location: expect.objectContaining({ line: 2, column: 26 }) })],
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
					notes: [expect.objectContaining({ message: "in function f", location: expect.objectContaining({ line: 2 }) })],
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

describe("Directive: .function, the block form", () => {
	describe("a call", () => {
		it("should run the body up to its .return, with loops and variables", () => {
			const bytes = assemble(`
				.function reverse(b) {
					r = 0
					.repeat 8 AS i {
						r = (r << 1) | ((b >> (i - 1)) & 1)
					}
					.return r
				}
				.db reverse(1), reverse($80), reverse($0F)
			`);
			expect(bytes).toEqual([0x80, 0x01, 0xf0]);
		});

		it("should take a body ending with .end, and .fn", () => {
			const bytes = assemble(`
				.fn sign(x)
					.if x < 0
						.return -1 & $ff
					.elseif x == 0
						.return 0
					.else
						.return 1
					.end
				.end
				.db sign(-5), sign(0), sign(7)
			`);
			expect(bytes).toEqual([0xff, 0, 1]);
		});

		it("should end at .return: what follows isn't run", () => {
			const bytes = assemble(`
				.function first(list) {
					.for item of list {
						.if item > 10 {
							.return item
						}
					}
					.error "none"
				}
				.db first([3, 12, 40])
			`);
			expect(bytes).toEqual([12]);
		});

		it("should run .break, .let and .log", () => {
			const sink = new MemorySink();
			const asm = new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
				logger: new Logger({ sink, enabled: true }),
				segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
				log: { pass2Enabled: true },
			});
			asm.assemble(`
				.function count(list) {
					.let "n" = 0
					.for item of list {
						.if item == 0 {
							.break
						}
						n = n + 1
					}
					.log "count", n
					.return n
				}
				.db count([5, 6, 0, 7])
			`);
			expect(asm.link()).toEqual([2]);
			expect(sink.logs.filter((line) => String(line).startsWith("count"))).toEqual(["count\t2"]);
		});

		it("should call itself, up to .option function.recursion", () => {
			const bytes = assemble(`
				.function fact(n) {
					.if n <= 1 {
						.return 1
					}
					.return n * fact(n - 1)
				}
				.option function.recursion 256
				.function depth(n) {
					.if n == 0 {
						.return 0
					}
					.return depth(n - 1) + 1
				}
				.db fact(5), depth(256) - 1
			`);
			expect(bytes).toEqual([120, 255]);
		});

		it("should take a label defined further down", () => {
			const bytes = assemble(`
				.function next(addr) {
					.return addr + 1
				}
				jmp next(target)
				nop
			target:
				nop
			`);
			expect(bytes).toEqual([0x4c, 0x05, 0x10, 0xea, 0xea]);
		});

		it("should be called in another function's expression and body", () => {
			const bytes = assemble(`
				.function sq(x) = x * x
				.function sumsq(list) {
					total = 0
					.for v of list {
						total = total + sq(v)
					}
					.return total
				}
				.function twice(x) = sumsq([x, x])
				.db twice(3)
			`);
			expect(bytes).toEqual([18]);
		});
	});

	describe("its variables", () => {
		it("should keep them in the call: an outer symbol of the same name is hidden, and read until assigned", () => {
			const bytes = assemble(`
				x = 1
				total = 50
				.function f() {
					x = x + 1
					.let "total" = x * 10
					.return total
				}
				.db f(), f(), x, total
			`);
			expect(bytes).toEqual([20, 20, 1, 50]);
		});

		it("should not leave them defined after the call", () => {
			expect(() =>
				assemble(`
				.function f() {
					tmp = 1
					.return tmp
				}
				.db f()
				.db tmp
			`),
			).toThrow("Undefined symbol 'TMP'.");
		});

		it("should not let .let assign a symbol of a namespace", () => {
			expect(() =>
				assemble(`
				.function f() {
					.let "global::x" = 1
					.return 0
				}
				.db f()
			`),
			).toThrow("A function's variables are its own: it can't assign 'global::x'.");
		});

		it("should run with the local options of where it's defined", () => {
			const bytes = assemble(`
				.function firstIndex() {
					.repeat 1 AS i {
						.return i
					}
				}
				.option repeat.start 0
				.db firstIndex()
				.repeat 1 AS i {
					.db i
				}
			`);
			expect(bytes).toEqual([1, 0]);
		});
	});

	describe("in a block not assembled or a macro", () => {
		it("should keep its .end, not the block's", () => {
			const bytes = assemble(`
				.if 0
					.function f(x)
						.return x
					.end
				.end
				.macro m
					.function g(x)
						.return x + 1
					.end
					.db g(1)
				.end
				m
			`);
			expect(bytes).toEqual([2]);
		});

		it("should read the parameters of the macro whose body defines it, in its statements", () => {
			const bytes = assemble(`
				.macro m limit
					.function clamp(x) {
						.if x > limit
							.return limit
						.end
						y = x + limit
						.return y - limit
					}
					.db clamp(3), clamp(20)
				.end
				m 10
			`);
			expect(bytes).toEqual([3, 10]);
		});
	});

	describe("errors", () => {
		it("should report a body ending without .return, at the call, with a note at the function", () => {
			expect(() =>
				assemble(`
				.function f(x) {
					y = x
				}
				nop
				.db f(1)
			`),
			).toThrow(
				expect.objectContaining({
					message: "Function 'f' ends without .return.",
					location: expect.objectContaining({ line: 6, column: 9 }),
					notes: [expect.objectContaining({ message: "in function f, defined here", location: expect.objectContaining({ line: 2 }) })],
				}),
			);
		});

		it("should locate an error in the body at the call, with a note at its line in the body", () => {
			expect(() =>
				assemble(`
				.function f(x) {
					y = 1
					.error "bad x: ", x
				}
				.db f(1)
			`),
			).toThrow(
				expect.objectContaining({
					message: "bad x: \t1",
					location: expect.objectContaining({ line: 6, column: 9 }),
					notes: [expect.objectContaining({ message: "in function f", location: expect.objectContaining({ line: 4, column: 6 }) })],
				}),
			);
		});

		it.each([
			["an instruction", "lda #1", "Instruction 'lda' can't be in a function: a function only computes a value."],
			["a label", "here:", "Label 'here' can't be in a function: a function only computes a value."],
			["a word alone", "here", "Label 'here' can't be in a function: a function only computes a value."],
			["a local label", ":loop", "Label ':loop' can't be in a function: a function only computes a value."],
			["a macro call", "m", "Macro 'm' can't be called in a function: a function only computes a value."],
			["data", ".db 1", ".DB can't be in a function: a function only computes a value."],
			["a .org", ".org $2000", ".ORG can't be in a function: a function only computes a value."],
			["a * =", "* = $2000", "'*' can't be set in a function: a function only computes a value."],
			["a .equ", "k .equ 1", ".EQU can't be in a function: a function only computes a value."],
			["a .function", ".function g(x) = x", ".FUNCTION can't be in a function: a function only computes a value."],
			["an .option", ".option repeat.start 0", ".OPTION can't be in a function: a function only computes a value."],
			["a .exitmacro", ".exitmacro", ".EXITMACRO can't be in a function: a function only computes a value."],
			["a .break out of a loop", ".break", "Unexpected directive '.BREAK': it isn't in a loop of the function 'f'."],
			["an unknown directive", ".retrun 1", "Syntax error - Unexpected directive 'RETRUN'"],
			["a .return without a value", ".return", "Missing expression."],
		])("should report %s in the body", (_, statement, message) => {
			const source = `
				.macro m
					nop
				.end
				.function f(x) {
					${statement}
					.return x
				}
				.macro caller
					.repeat 2
						.db f(1)
					.end
				.end
				caller
			`;
			expect(() => assemble(source)).toThrow(message);
		});

		it("should report a .return out of a function", () => {
			expect(() => assemble(".return 1")).toThrow("Unexpected directive '.RETURN': it isn't in a function.");
		});
	});

	it("should not list its body, only the line calling it", () => {
		const sink = new MemorySink();
		const asm = new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
			logger: new Logger({ sink, enabled: true }),
			segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
			log: { pass2Enabled: true },
		});
		asm.assemble(`
			.function sum(list) {
				t = 0
				.for v of list {
					t = t + v
				}
				.return t
			}
			.db sum([1, 2])
		`);
		const lines = sink.logs
			.map((line) => String(line).replace(/\s+/g, " ").trim())
			.filter((line) => line && !line.startsWith("---") && !line.includes(".set namespace"));
		// The definition's quotes are 1.63.
		expect(lines).toEqual(['.function "sum(list)"', "1000: 03 .db $03"]);
	});
});
