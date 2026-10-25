import { describe, expect, it } from "vitest";
import { ExpressionEvaluator } from "../../assembler/expression";
import { Assembler } from "../../assembler/polyasm";
import { PASymbolTable } from "../../assembler/symbol.class";
import { Cpu6502Handler } from "../../cpu/cpu6502.class";
import { NullLister } from "../../helpers/lister.class";
import type { Segment } from "../../linker/linker.class";
import { AssemblyLexer } from "../../shared/lexer/lexer.class";
import { MockFileHandler } from "../mockfilehandler.class";

describe("Function .SEGMENT()", () => {
	const assemble = (source: string) => {
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler());
		const segments = assembler.assemble(source);
		return segments.find((s) => s.name === "CODE")?.data.slice(0, 4);
	};

	it("should return a segment defined before", () => {
		const source = `
			.SEGMENT DATA { start: $9000, size: $10 }
			.SEGMENT CODE { start: $8000, size: $10 }
			.SEGMENT "CODE"
			s = .segment("DATA")
			.WORD s.start, s.size
		`;
		expect(assemble(source)).toEqual([0x00, 0x90, 0x10, 0x00]);
	});

	it("should return a segment defined further down", () => {
		const source = `
			.SEGMENT CODE { start: $8000, size: $10 }
			.SEGMENT "CODE"
			s = .segment("DATA")
			.WORD s.start, s.size
			.SEGMENT DATA { start: $9000, size: $10 }
		`;
		expect(assemble(source)).toEqual([0x00, 0x90, 0x10, 0x00]);
	});

	it("should size an instruction using a segment defined further down", () => {
		const source = `
			.SEGMENT CODE { start: $8000, size: $10 }
			.SEGMENT "CODE"
			s = .segment("DATA")
			lda s.start
			rts
			.SEGMENT DATA { start: $9000, size: $10 }
		`;
		expect(assemble(source)).toEqual([0xad, 0x00, 0x90, 0x60]);
	});

	it("should throw for a segment never defined", () => {
		const source = `
			.SEGMENT CODE { start: $8000, size: $10 }
			.SEGMENT "CODE"
			s = .segment("NOPE")
		`;
		expect(() => assemble(source)).toThrow("Segment 'NOPE' not found.");
	});

	it("should throw for a name that isn't a string", () => {
		const source = `
			.SEGMENT CODE { start: $8000, size: $10 }
			.SEGMENT "CODE"
			s = .segment(1)
		`;
		expect(() => assemble(source)).toThrow("Argument to .SEGMENT() must be a string.");
	});
});

describe("Function .SEGMENT(), with a stub host", () => {
	const DATA: Segment = { name: "DATA", start: 0x9000, size: 0x10, data: [] };

	const setup = () => {
		const evaluator = new ExpressionEvaluator(new PASymbolTable(new NullLister()), {
			resolveSysValue: () => undefined,
			findSegment: (name) => (name === DATA.name ? DATA : undefined),
		});
		const lexer = new AssemblyLexer();
		const tokenize = (expr: string) => lexer.tokenize(expr).filter((t) => t.type !== "EOF");
		return { evaluator, tokenize };
	};

	it("should return the segment the host finds", () => {
		const { evaluator, tokenize } = setup();
		expect(evaluator.evaluate(tokenize('.segment("DATA")'), { PC: { value: 0 } })).toBe(DATA);
	});

	it("should give null in pass 1 for a segment the host doesn't know yet", () => {
		const { evaluator, tokenize } = setup();
		expect(evaluator.evaluate(tokenize('.segment("NOPE")'), { PC: { value: 0 }, allowForwardRef: true })).toBeNull();
	});

	it("should throw in pass 2 for a segment the host doesn't know", () => {
		const { evaluator, tokenize } = setup();
		expect(() => evaluator.evaluate(tokenize('.segment("NOPE")'), { PC: { value: 0 } })).toThrow("Segment 'NOPE' not found.");
	});
});
