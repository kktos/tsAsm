import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import type { SymbolValue } from "../assembler/symbol.class";
import { yamlparse } from "../cli/asm-yaml";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import type { Token } from "../shared/lexer/lexer.class";
import { MockFileHandler } from "./mockfilehandler.class";

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("Macro Handling", () => {
	const setup = () => {
		const assembler = new Assembler(new Cpu65C02Handler(), new MockFileHandler(), { segments: DEFAULT_SEGMENTS });
		const { symbolTable, expressionEvaluator: evaluator } = assembler;
		const lexer = assembler.parser.lexer;
		const tokenize = (expr: string) => lexer.tokenize(expr).filter((t) => t.type !== "EOF");
		return { assembler, symbolTable, evaluator, lexer, tokenize };
	};

	describe("Macro Argument Evaluation", () => {
		it("should resolve a simple numeric macro argument in an expression", () => {
			const { evaluator, tokenize } = setup();
			const macroArgs = new Map<string, Token[]>();
			macroArgs.set("MY_ARG", tokenize("10"));

			const tokens = tokenize("MY_ARG * 2");
			const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 }, macroArgs });
			expect(result).toBe(20);
		});

		it("should resolve a macro argument that is itself an expression", () => {
			const { evaluator, tokenize, symbolTable } = setup();
			symbolTable.defineVariable("FIVE", 5, { filename: "test", line: 1, column: 1 });
			const macroArgs = new Map<string, Token[]>();
			// The argument passed to the macro is "FIVE + 5"
			macroArgs.set("COMPLEX_ARG", tokenize("FIVE + 5"));

			// The expression inside the macro is "COMPLEX_ARG / 2"
			const tokens = tokenize("COMPLEX_ARG / 2");
			// Expected: (5 + 5) / 2 = 5
			const result = evaluator.evaluateAsNumber(tokens, { PC: { value: 0 }, macroArgs });
			expect(result).toBe(5);
		});

		it("should perform a full macro expansion with argument substitution", () => {
			const { assembler, symbolTable } = setup();

			// Define a simple macro, then use it (each assemble() call starts afresh)
			assembler.assemble(`.MACRO MY_MACRO(arg1, arg2)
				LDA #arg1
				STA $2000
				LDA #arg2
				STA $2001
				.END
				MY_MACRO(10, 20)`);

			const machineCode6502 = assembler.link();
			expect(machineCode6502).toEqual([0xa9, 0x0a, 0x8d, 0x00, 0x20, 0xa9, 0x14, 0x8d, 0x01, 0x20]);

			// Check if the symbols are defined correctly after macro expansion
			expect(symbolTable.lookupSymbol("arg1")).toBeUndefined(); // Macro arguments should not leak into the symbol table
			expect(symbolTable.lookupSymbol("arg2")).toBeUndefined();
		});

		it("tests a c-like macro with no parameters", () => {
			const { assembler } = setup();
			const src = `
				.macro nopnopnop
					nop
					nop
					nop
				.end

				start:
					nopnopnop
			`;
			assembler.assemble(src);
			const machineCode6502 = assembler.link();

			expect(machineCode6502).toEqual([0xea, 0xea, 0xea]);
		});

		it.each([
			[
				"{ on its line",
				`.macro twonops {
nop
nop
}
twonops
twonops`,
			],
			[
				"{ right after its name",
				`.macro twonops{
nop
nop
}
twonops
twonops`,
			],
		])("should define a macro without parameters and with %s", (_, src) => {
			const { assembler } = setup();
			assembler.assemble(src);

			expect(assembler.link()).toEqual([0xea, 0xea, 0xea, 0xea]);
		});

		it("should define a macro without parameters and with a one-line body", () => {
			const { assembler } = setup();
			assembler.assemble(`.macro onenop { nop }
onenop
onenop`);

			expect(assembler.link()).toEqual([0xea, 0xea]);
		});

		it("should place what follows a { } macro without parameters in both passes", () => {
			const { assembler } = setup();
			assembler.assemble(`.macro m {
nop
}
.db 7
m
lbl: .dw lbl`);

			expect(assembler.link()).toEqual([0x07, 0xea, 0x02, 0x10]);
		});

		it("should raise an error for a macro with extra parameters", () => {
			const { assembler } = setup();
			const src = `
				.macro nopnopnop
					nop
					nop
					nop
				.end

				start:
					nopnopnop 98
			`;
			expect(() => assembler.assemble(src)).toThrow(
				expect.objectContaining({
					message: "Macro 'NOPNOPNOP' expects 0 arguments, but got 1.",
					location: expect.objectContaining({ line: 9 }),
				}),
			);
		});

		it("tests macro with strings", () => {
			const { assembler } = setup();
			const src = `
				.macro log fmt, parm1
					.db $42,$FF
					.cstr fmt
					.db 1
					.dw parm1
				.end

				.org $1000
				mem:
				log "ABCD", mem
			`;
			assembler.assemble(src);
			const machineCode6502 = assembler.link();

			expect(machineCode6502).toEqual([0x42, 0xff, 0x41, 0x42, 0x43, 0x44, 0x00, 0x01, 0x00, 0x10]);
		});

		it("tests macro with label definitions", () => {
			const { assembler } = setup();
			const src = `
				.macro delRegions(...list) {
					brk
					.db $04
					.db .len(list)

					.for name of list as idx {
						.dw .label("region" + .str(idx))
					}

					bra :+

					.for name of list as idx {
						.let "region" + .str(idx) = *
						.cstr name
					}

			:
				}

				delRegions "AB", "CD", "EF"
			`;
			assembler.assemble(src);

			expect(assembler.symbolTable.findSymbol("region0")?.symbol.value).toBe(0x1000 + 3 + 3 * 2 + 2);
			expect(assembler.symbolTable.findSymbol("region1")?.symbol.value).toBe(0x1000 + 3 + 3 * 2 + 2 + 2 + 1);
			expect(assembler.symbolTable.findSymbol("region2")?.symbol.value).toBe(0x1000 + 3 + 3 * 2 + 2 + 2 + 2 + 2);
		});
	});

	describe("Macro Argument Substitution", () => {
		it("should perform a full argument substitution", () => {
			const { assembler, symbolTable } = setup();

			// Define a simple macro, then use it (each assemble() call starts afresh)
			assembler.assemble(`
				.MACRO MY_MACRO arg1, arg2
					LDA arg1
					STA $2000
					LDA arg2
					STA $2001
				.END
				MY_MACRO <#$10>, $300
			`);

			const machineCode6502 = assembler.link();
			expect(machineCode6502).toEqual([0xa9, 0x10, 0x8d, 0x00, 0x20, 0xad, 0x0, 0x3, 0x8d, 0x01, 0x20]);

			// Check if the symbols are defined correctly after macro expansion
			expect(symbolTable.lookupSymbol("arg1")).toBeUndefined(); // Macro arguments should not leak into the symbol table
			expect(symbolTable.lookupSymbol("arg2")).toBeUndefined();
		});

		it("should work with indexed addressing mode", () => {
			const { assembler, symbolTable } = setup();

			// Define a simple macro, then use it (each assemble() call starts afresh)
			assembler.assemble(`
				.MACRO save arg1, arg2
					LDA arg1
					STA $2000
					LDA arg2
					STA $2001
				.END

				.org $1000
				save <data,x>, <#10> ; Call macro with '<data,x>' and '<#10>'

				data: .db 0,1,2,3,4,5,6,7,8,9
			`);

			const machineCode6502 = assembler.link();
			// The macro expands to:
			// LDA data,x  ; BD 0C 10 (data is at 0x100C after the macro expansion)
			// STA $2000   ; 8D 00 20
			// LDA #10     ; A9 0A
			// STA $2001   ; 8D 01 20
			// The test below assumes 'data' is at address $1000, so LDA data,x becomes BD 00 10
			// Corrected expectation: The macro itself takes up 12 bytes. The default start is 0x1000. So 'data' will be at 0x100C.
			expect(machineCode6502).toEqual([0xbd, 0x0b, 0x10, 0x8d, 0x00, 0x20, 0xa9, 0x0a, 0x8d, 0x01, 0x20, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

			// Check if the symbols are defined correctly after macro expansion
			expect(symbolTable.lookupSymbol("arg1")).toBeUndefined(); // Macro arguments should not leak into the symbol table
			expect(symbolTable.lookupSymbol("arg2")).toBeUndefined();
		});

		it("should evaluate an argument in the caller's scope, not against the macro's parameters", () => {
			const { assembler } = setup();
			assembler.assemble(`
				.macro m a, b
					.db a, b
					lda #a
				.end
				b = 7
				m b, 2
			`);
			// a is the global b (7), not the parameter b (2)
			expect(assembler.link()).toEqual([0x07, 0x02, 0xa9, 0x07]);
		});

		it("should accept an argument with the same name as its parameter", () => {
			const { assembler } = setup();
			assembler.assemble(`
				.macro m a
					.db a
				.end
				a = 5
				m a
			`);
			expect(assembler.link()).toEqual([0x05]);
		});
	});

	describe("Macro parameter forwarding", () => {
		const assemble = (source: string) => {
			const { assembler } = setup();
			assembler.assemble(source);
			return assembler.link();
		};

		it("should forward a parameter to a nested macro, in directives and instructions", () => {
			expect(
				assemble(`
					.macro inner v
						.db v
						lda #v
					.end
					.macro outer a
						inner a
						inner a+1
					.end
					outer 9
				`),
			).toEqual([0x09, 0xa9, 0x09, 0x0a, 0xa9, 0x0a]);
		});

		it("should forward parameters whose names clash with the nested macro's", () => {
			expect(
				assemble(`
					.macro inner a, b
						.db a, b
					.end
					.macro outer a, b
						inner b, a
					.end
					outer 1, 2
				`),
			).toEqual([0x02, 0x01]);
		});

		it("should forward an indexed rest parameter and an addressing mode", () => {
			expect(
				assemble(`
					.macro load src
						lda src
					.end
					.macro emit v
						.db v
					.end
					.macro pick ...p
						emit p[1]
						load p[0]
					.end
					table: .db 0
					pick <table,x>, 5
				`),
			).toEqual([0x00, 0x05, 0xbd, 0x00, 0x10]);
		});

		it("should forward from inside a .repeat block", () => {
			expect(
				assemble(`
					.macro inner v
						.db v
					.end
					.macro outer a
						.repeat 2 AS i
							inner a+i
						.end
					.end
					outer 10
				`),
			).toEqual([0x0b, 0x0c]);
		});

		it("should support recursion with an end condition", () => {
			expect(
				assemble(`
					.macro down n
						.if n > 0
							.db n
							down n-1
						.end
					.end
					down 5
				`),
			).toEqual([5, 4, 3, 2, 1]);
		});
	});

	describe("Commas in a macro argument", () => {
		const assemble = (source: string) => {
			const { assembler } = setup();
			assembler.assemble(source);
			return assembler.link();
		};
		const one = (call: string) => `.macro m a
.db a
.end
${call}`;

		it.each([
			["[ ]", "m [1,2][1]", [0x02]],
			["[ ], with ( ) around the arguments", "m([1,2][1])", [0x02]],
			["a function call", "m .iif(1,2,3)", [0x02]],
			["a function call with a '<'", "m .iif(1<2, 3, 4)", [0x03]],
		])("should keep a comma inside %s in its argument", (_, call, bytes) => {
			expect(assemble(one(call))).toEqual(bytes);
		});

		it("should split the arguments at the commas outside ( ) and [ ]", () => {
			expect(
				assemble(`.macro m a, b, c
.db a, b, c
.end
m .iif(1,2,3), [3,4][0], 5`),
			).toEqual([0x02, 0x03, 0x05]);
		});

		it("should keep an indirect addressing mode in its text argument", () => {
			expect(
				assemble(`.macro m a, b
.db a
lda b
.end
m 1, <($12,x)>`),
			).toEqual([0x01, 0xa1, 0x12]);
		});

		it("should pass an array to a rest parameter as one argument", () => {
			expect(
				assemble(`.macro m ...a
.db .len(a), a[0][1]
.end
m [1,2], 3`),
			).toEqual([0x02, 0x02]);
		});

		it("should forward an argument with a comma to a nested macro", () => {
			expect(
				assemble(`.macro inner a
.db a
.end
.macro outer b
inner b
.end
outer [1,2][0]`),
			).toEqual([0x01]);
		});
	});

	describe("Value and text arguments", () => {
		const assemble = (source: string) => {
			const { assembler } = setup();
			assembler.assemble(source);
			return assembler.link();
		};

		it("should read a '(' after a space as the start of an argument", () => {
			expect(
				assemble(`.macro m a
.db a
.end
m (1+2)*3`),
			).toEqual([0x09]);
		});

		it("should evaluate a value argument in an instruction, as in a directive", () => {
			expect(
				assemble(`.macro m a
lda a*2
.db a*2
.end
m 1+2`),
			).toEqual([0xa5, 0x06, 0x06]);
		});

		it.each([
			["without ( )", "m <($12,x)>"],
			["with ( )", "m(<($12,x)>)"],
		])("should paste a text argument %s", (_, call) => {
			expect(
				assemble(`.macro m a
lda a
.end
${call}`),
			).toEqual([0xa1, 0x12]);
		});

		it.each([
			["an immediate", "m #5", "'#5' is an addressing mode, not an expression. Pass it as text, in < >: <#5>."],
			["an indirect mode", "m ($12,x)", "'($12,x)' is an addressing mode"],
			["an indirect mode, with ( )", "m(($12,x))", "'($12,x)' is an addressing mode"],
		])("should reject %s outside < >", (_, call, message) => {
			expect(() =>
				assemble(`.macro m a
lda a
.end
${call}`),
			).toThrow(message);
		});

		it.each([
			["in the middle", ".macro m x, y, z", "m 1,,2", "argument 2 is empty"],
			["at the end", ".macro m x, y", "m 1,", "argument 2 is empty"],
			["at the start", ".macro m x, y", "m ,1", "argument 1 is empty"],
			["with ( )", ".macro m(x, y, z)", "m(1,,2)", "argument 2 is empty"],
			["at the end, with ( )", ".macro m(x, y)", "m(1,)", "argument 2 is empty"],
			["in a rest parameter", ".macro m ...a", "m 1,,2", "argument 2 is empty"],
			["at the end of a rest parameter", ".macro m ...a", "m 1,", "argument 2 is empty"],
		])("should reject an empty argument %s", (_, definition, call, message) => {
			expect(() =>
				assemble(`${definition}
.end
${call}`),
			).toThrow(`Macro 'M': ${message}. An argument is a value; pass empty text as <>.`);
		});

		it("should accept empty text in < >", () => {
			expect(
				assemble(`.macro m x, y, z
.db x
y
.db z
.end
m 1,<>,2`),
			).toEqual([0x01, 0x02]);
		});

		it("should still call a macro without arguments", () => {
			expect(
				assemble(`.macro m
.db 1
.end
m
m()`),
			).toEqual([0x01, 0x01]);
		});

		it("should end a text argument at its '>'", () => {
			expect(() =>
				assemble(`.macro m a
.db a
.end
m <1>+1`),
			).toThrow("Unexpected '+' after '>': a macro argument in < > ends at its '>'.");
		});

		it("should forward a text argument as text", () => {
			expect(
				assemble(`.macro inner v
lda v
.end
.macro outer t
inner t
.end
outer <#5>`),
			).toEqual([0xa9, 0x05]);
		});

		it("should forward a value argument as a value", () => {
			expect(
				assemble(`.macro inner v
.db v
.end
.macro outer b
inner b*2
.end
outer 1+2`),
			).toEqual([0x06]);
		});
	});

	describe("Indexing a rest parameter", () => {
		const assemble = (source: string) => {
			const { assembler } = setup();
			assembler.assemble(source);
			return assembler.link();
		};
		const callM = (body: string) => `.macro m ...a
${body}
.end
m 1, 2+3, "ab"`;

		it.each([
			[".db", ".db a[1]", [0x05]],
			["an operator", ".db a[1] + 1, a[0]", [0x06, 0x01]],
			[".dw", ".dw a[0]", [0x01, 0x00]],
			[".text", ".text a[2]", [0x61, 0x62]],
			[".len()", ".db .len(a[2])", [0x02]],
			[".if", ".if a[0] = 1\n.db 9\n.end", [0x09]],
			["an index from .for", ".for i of [0, 1]\n.db a[i]\n.end", [0x01, 0x05]],
			["a copy", "t = a\n.db t[1]", [0x05]],
		])("should give the argument's value in %s", (_, body, bytes) => {
			expect(assemble(callM(body))).toEqual(bytes);
		});

		it("should evaluate the argument in the caller's scope, not against the macro's parameters", () => {
			expect(
				assemble(`a = 50
.macro m ...a
.db a[0]
.end
m a`),
			).toEqual([50]);
		});

		it("should evaluate the argument after a regular parameter, and with ( )", () => {
			expect(
				assemble(`.macro m first, ...a
.db first, a[0]
.end
.macro n(...a) {
.db a[1]
}
m 1, 2
n(3, 4)`),
			).toEqual([0x01, 0x02, 0x04]);
		});

		it("should take a label defined later", () => {
			expect(
				assemble(`.macro m ...a
.dw a[0]
.end
m lbl
lbl: .db 7`),
			).toEqual([0x02, 0x10, 0x07]);
		});

		it("should index an array argument", () => {
			expect(
				assemble(`.macro m ...a
.db a[0][0]
.end
m [4]`),
			).toEqual([0x04]);
		});

		it("should report an error in the argument", () => {
			expect(() =>
				assemble(`.macro m ...a
.db a[0]
.end
m nope`),
			).toThrow("Undefined symbol 'NOPE'.");
		});
	});

	describe("Macro redefinition", () => {
		it("should throw when a macro is defined twice", () => {
			const { assembler } = setup();
			const source = `
				.macro m
					nop
				.end
				.db 7
				.macro m
					rts
				.end
			`;
			expect(() => assembler.assemble(source)).toThrow(
				expect.objectContaining({
					message: "Macro 'm' redefined: a macro can only be defined once.",
					location: expect.objectContaining({ line: 6 }),
					notes: [
						expect.objectContaining({
							message: "first defined here",
							location: expect.objectContaining({ line: 2 }),
						}),
					],
				}),
			);
		});
	});

	describe("Macro name", () => {
		it("should ask for a name, not take the first word of the body", () => {
			const { assembler } = setup();
			const source = `
				.macro
					nop
				.end
			`;
			expect(() => assembler.assemble(source)).toThrow(
				expect.objectContaining({ message: "A macro needs a name.", location: { file: "", line: 2, column: 6 } }),
			);
		});

		it("should ask for a name, not a number", () => {
			const { assembler } = setup();
			const source = `
				.macro 12
					nop
				.end
			`;
			expect(() => assembler.assemble(source)).toThrow(
				expect.objectContaining({ message: "A macro needs a name.", location: { file: "", line: 2, column: 12 } }),
			);
		});

		it("should ask for a name before a { } body", () => {
			const { assembler } = setup();
			const source = `
				.macro {
					nop
				}
			`;
			expect(() => assembler.assemble(source)).toThrow(
				expect.objectContaining({ message: "A macro needs a name.", location: { file: "", line: 2, column: 12 } }),
			);
		});
	});

	describe("Macro nesting depth", () => {
		const nested = `
			.macro m3
				.db 3
			.end
			.macro m2
				m3
			.end
			.macro m1
				m2
			.end
			m1
		`;

		it("should throw on a recursive macro instead of running out of memory", () => {
			const { assembler } = setup();
			expect(() => assembler.assemble(".macro m\n m\n.end\n m")).toThrow("Macro 'M' nested more than 32 levels deep");
		});

		it("should allow nesting up to maxMacroDepth", () => {
			const assembler = new Assembler(new Cpu65C02Handler(), new MockFileHandler(), {
				segments: DEFAULT_SEGMENTS,
				maxMacroDepth: 3,
			});
			assembler.assemble(nested);
			expect(assembler.link()).toEqual([3]);
		});

		it("should stop a recursive macro with an end condition at maxMacroDepth", () => {
			const { assembler } = setup();
			const down = (n: number) => `.macro down n\n.if n > 0\ndown n-1\n.end\n.end\n down ${n}`;
			expect(() => assembler.assemble(down(40))).toThrow("Macro 'DOWN' nested more than 32 levels deep");
		});

		it("should throw beyond maxMacroDepth", () => {
			const assembler = new Assembler(new Cpu65C02Handler(), new MockFileHandler(), {
				segments: DEFAULT_SEGMENTS,
				maxMacroDepth: 2,
			});
			expect(() => assembler.assemble(nested)).toThrow("Macro 'M3' nested more than 2 levels deep");
		});
	});

	describe("Symbol redefined in a macro body", () => {
		it("should name the macro of a redefined label", () => {
			const { assembler } = setup();
			const source = `
				.macro m
				count:
				count:
				.end
				m
			`;
			expect(() => assembler.assemble(source)).toThrow(expect.objectContaining({ message: "Symbol 'COUNT' redefined in macro m." }));
		});

		it("should name the macro of a redefined constant", () => {
			const { assembler } = setup();
			const source = `
				.macro m
				k .equ 1
				k = 2
				.end
				m
			`;
			expect(() => assembler.assemble(source)).toThrow(expect.objectContaining({ message: "Can't redefine constant 'K' in macro m." }));
		});

		it("should name the function of a label redefined in a function of a macro body", () => {
			const { assembler } = setup();
			const source = `
				.macro m
				.function f
				count:
				count:
				.end
				.end
				m
			`;
			expect(() => assembler.assemble(source)).toThrow(expect.objectContaining({ message: "Symbol 'COUNT' redefined in function f." }));
		});
	});

	describe("Macro defining symbols", () => {
		it("should be able to resolve labels defined within a macro", () => {
			const { assembler } = setup();
			const src = `
				.macro log
					beq skip
					nop
					skip:
				.end
				log
			`;
			assembler.assemble(src);
			const machineCode6502 = assembler.link();

			expect(machineCode6502).toEqual([0xf0, 0x01, 0xea]);
		});

		it("should give each call its own labels, even from the same line in a loop", () => {
			const { assembler } = setup();
			const src = `
				.macro log
					beq skip
					nop
					skip:
				.end
				.repeat 2 {
					log
				}
				log
			`;
			assembler.assemble(src);
			const machineCode6502 = assembler.link();

			expect(machineCode6502).toEqual([0xf0, 0x01, 0xea, 0xf0, 0x01, 0xea, 0xf0, 0x01, 0xea]);
		});

		it("should keep an .EQU defined within a macro", () => {
			const { assembler } = setup();
			const src = `
				.macro m
					k .equ 1
					.db k
				.end
				m
			`;
			assembler.assemble(src);
			const machineCode6502 = assembler.link();

			expect(machineCode6502).toEqual([1]);
		});

		it("should keep a .DEFINE block within a macro", () => {
			const assembler = new Assembler(new Cpu65C02Handler(), new MockFileHandler(), {
				segments: DEFAULT_SEGMENTS,
				rawDataProcessors: { default: "yaml", map: new Map([["yaml", (blockContent: string) => yamlparse(blockContent) as SymbolValue]]) },
			});
			const src = `
				.macro m
					.define x
- 5
- 6
					.end
					.db x[1]
				.end
				m
			`;
			assembler.assemble(src);
			const machineCode6502 = assembler.link();

			expect(machineCode6502).toEqual([6]);
		});
	});

	describe("Macro and Namespace", () => {
		it("should resolve a simple numeric macro argument in an expression", () => {
			const { assembler } = setup();
			const src = `
				.macro log
					.db test
				.end

				test = 1

				.namespace earth
					test = 2
					log
				.end namespace

				log
			`;
			assembler.assemble(src);
			const machineCode6502 = assembler.link();

			expect(machineCode6502).toEqual([2, 1]);
		});
	});

	describe("real life example", () => {
		it("should works ;)", () => {
			const { assembler } = setup();
			const src = `
				.macro assertDefinedLabels neededLabels, errmsg
					.if .type(neededLabels) != "array"
						.error "checkIfDefined needs an array of strings as label names"
					.end

					.log "neededLabels = ", neededLabels

					missingLabels = .array()
					.for label of neededLabels

						.log "label = ",label, "undef?", .undef((label))

						.if .undef((label))
							.log "add label", label
							missingLabels= .push(missingLabels, label)
						.end
					.end

					.log "len(missingLabels) = ", .len(missingLabels)

					.if .len(missingLabels) != 0
						.error errmsg, " ", missingLabels
					.end
				.end

				labels = .array("ONE", "TWO")
				assertDefinedLabels labels, "Missing game interface fields"

			`;

			expect(() => assembler.assemble(src)).toThrow(/Missing game interface fields\s+\[ONE, TWO\]/);
		});
		it("should works too ;)", () => {
			const { assembler } = setup();
			const src2 = `
				.macro ifx ...parms {

					len= .len(parms)

					.if len<3 && len>4
						.error "Macro ifx : needs min 3 params and max 4"
					.end

					parmIdx= 0

					.echo "len=4",len=4

					t = parms[parmIdx]

					.echo .type(t)

					.if len=4
						;.echo "LDX",parms[parmIdx]
						ldx parms[parmIdx]
						parmIdx= parmIdx + 1
					.else
						.echo "len != 4 !!"
					.end

					op= parms[parmIdx]
					goto= parms[parmIdx+2]

					isValidOp= 0

					cpx parms[parmIdx+1]

					.if op="<" {
						isValidOp= 1
						bcc goto
					}

					.if op="<="
						isValidOp= 1
						bcc goto
						beq goto
					.end

					.if op=">"
						isValidOp= 1
						beq :+
						bcs goto
						:
					.end

					.if op=">="
						isValidOp= 1
						bcs goto
						:
					.end

					.if !isValidOp
						.error "Macro ifx : Invalid Operation ",op
					.end

				}

				start:
					ifx $300, "<", <#10>, end

					nop

				end:
					rts

			`;

			assembler.assemble(src2);
			const machineCode6502 = assembler.link();

			expect(machineCode6502).toEqual([0xae, 0x00, 0x03, 0xe0, 0x0a, 0x90, 0x01, 0xea, 0x60]);
		});

		it("should error on old syntax", () => {
			const { assembler } = setup();
			const src2 = `
				.macro drawSprite(one,two,three) {
				}

				start:
					drawSprite #$54:#$2e:#$10
			`;

			expect(() => assembler.assemble(src2)).toThrow(
				expect.objectContaining({
					message: "Macro 'DRAWSPRITE' expects 3 arguments, but got 1.",
					location: expect.objectContaining({ line: 6 }),
				}),
			);
		});
	});
});
