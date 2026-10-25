import { describe, expect, it } from "vitest";
import { ExpressionEvaluator } from "../../assembler/expression";
import type { EvaluatorHost } from "../../assembler/expression.types";
import { Assembler } from "../../assembler/polyasm";
import { PASymbolTable } from "../../assembler/symbol.class";
import { Cpu6502Handler } from "../../cpu/cpu6502.class";
import { NullLister } from "../../helpers/lister.class";
import { AssemblyLexer } from "../../shared/lexer/lexer.class";
import { MockFileHandler } from "../mockfilehandler.class";

describe("Functions DEF() / UNDEF()", () => {
	const assemble = (source: string) => {
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler());
		assembler.assemble(source);
		return assembler.link();
	};

	describe("the name", () => {
		it("should take a symbol's name as is, without evaluating it", () => {
			const code = assemble(`
				Z = 0
				.db .def(Z), .undef(Z), .def(NOPE), .undef(NOPE)
			`);
			expect(code).toEqual([1, 0, 0, 1]);
		});

		it("should take a namespaced name as is", () => {
			const code = assemble(`
				.namespace utils
				getKey = 1
				.end namespace
				.db .def(utils::getKey), .def(utils::nope)
			`);
			expect(code).toEqual([1, 0]);
		});

		it("should take a name given as a string", () => {
			const code = assemble(`
				Z = 0
				.db .def("Z"), .def("utils::nope")
			`);
			expect(code).toEqual([1, 0]);
		});

		it("should evaluate any other expression, which gives the name", () => {
			const code = assemble(`
				names = .array("A", "B")
				name = "A"
				A = 1
				.db .def(names[0]), .def(names[1]), .def((name))
			`);
			expect(code).toEqual([1, 0, 1]);
		});

		it("should reject an expression that doesn't give a name", () => {
			expect(() => assemble(".db .def(1+2)")).toThrow('.DEF() needs a symbol name: .DEF(X) or .DEF("X").');
			expect(() =>
				assemble(`
				A = 1
				.db .undef((A))
			`),
			).toThrow('.UNDEF() needs a symbol name: .UNDEF(X) or .UNDEF("X").');
		});

		it("should take the name passed to a macro parameter", () => {
			const code = assemble(`
				.macro need sym
					.db .def(sym)
				.end
				FOO = 0
				need FOO
				need BAR
				need "FOO"
			`);
			expect(code).toEqual([1, 0, 1]);
		});
	});

	describe("defined at this point, in both passes", () => {
		it("should not drop the content of an .if .undef(X) guard", () => {
			const code = assemble(`
				.if .undef(R_INC) {
					R_INC = 1
					spr: .db 7, 8
				}
				.if .undef(R_INC) {
					R_INC = 1
					.db 9
				}
			`);
			expect(code).toEqual([7, 8]);
		});

		it("should not see a symbol defined further down", () => {
			const code = assemble(`
				.db .def(later), .def(X)
				later: .db 9
				X = 5
				.db .def(later), .def(X)
			`);
			expect(code).toEqual([0, 0, 9, 1, 1]);
		});

		it("should take the same .if branch in both passes", () => {
			const code = assemble(`
				.if .def(X)
					.db 1
				.else
					.dw 2
				.end
				X = 5
				after: .db <after
			`);
			expect(code).toEqual([2, 0, 2]);
		});

		it("should see a macro once its .macro is reached", () => {
			const code = assemble(`
				.db .def(m), .def("m")
				.macro m
				.end
				.db .def(m), .def("m"), .undef(m)
			`);
			expect(code).toEqual([0, 0, 1, 1, 0]);
		});

		it("should see the symbols set up before assembling", () => {
			const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler());
			assembler.symbolTable.defineConstant("PRESET", 1, { filename: "", line: 0, column: 0 });
			assembler.assemble(".db .def(PRESET)");
			expect(assembler.link()).toEqual([1]);
		});
	});
});

describe("Functions DEF() / UNDEF(), with a stub host", () => {
	const setup = (isMacroDefined?: EvaluatorHost["isMacroDefined"]) => {
		const evaluator = new ExpressionEvaluator(new PASymbolTable(new NullLister()), {
			resolveSysValue: () => undefined,
			findSegment: () => undefined,
			isMacroDefined,
		});
		const lexer = new AssemblyLexer();
		const evaluate = (expr: string) =>
			evaluator.evaluate(
				lexer.tokenize(expr).filter((t) => t.type !== "EOF"),
				{ PC: { value: 0 } },
			);
		return { evaluate };
	};

	it("should see the macros the host says are defined", () => {
		const { evaluate } = setup((name) => name === "M");
		expect([evaluate(".def(M)"), evaluate(".undef(M)"), evaluate(".def(N)")]).toEqual([1, 0, 0]);
	});

	it("should see no macro when the host has no isMacroDefined", () => {
		const { evaluate } = setup();
		expect([evaluate(".def(M)"), evaluate(".undef(M)")]).toEqual([0, 1]);
	});
});
