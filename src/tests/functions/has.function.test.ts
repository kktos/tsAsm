import { describe, expect, it } from "vitest";
import { Assembler } from "../../assembler/polyasm";
import { Cpu6502Handler } from "../../cpu/cpu6502.class";
import { Logger } from "../../helpers/logger.class";
import { MemorySink } from "../../helpers/memorysink.class";
import { MockFileHandler } from "../mockfilehandler.class";

const newAssembler = () => new Assembler(new Cpu6502Handler(), new MockFileHandler(), { logger: new Logger({ sink: new MemorySink(), enabled: false }) });

/** `.has(…)` evaluated with the variable `cfg`, an object. */
function evaluate(expression: string, cfg: object = { kind: 1, loadName: "MAIN" }) {
	const assembler = newAssembler();
	assembler.symbolTable.defineVariable("cfg", cfg, { filename: "test", line: 1, column: 1 });
	const tokens = assembler.parser.lexer.tokenize(expression).filter((t) => t.type !== "EOF");
	return assembler.expressionEvaluator.evaluate(tokens, { PC: { value: 0 } });
}

describe("Function .HAS()", () => {
	it("should give 1 when the object has the key, else 0", () => {
		expect(evaluate(`.has(cfg, "kind")`)).toBe(1);
		expect(evaluate(`.has(cfg, "segname")`)).toBe(0);
	});

	it("should take the key as written, as a field is read", () => {
		expect(evaluate(`.has(cfg, "loadName")`)).toBe(1);
		expect(evaluate(`.has(cfg, "loadname")`)).toBe(0);
	});

	it("should take a computed key", () => {
		expect(evaluate(`.has(cfg, "ki" + "nd")`)).toBe(1);
	});

	it("should not find what every object inherits", () => {
		expect(evaluate(`.has(cfg, "toString")`)).toBe(0);
	});

	it.each([
		[`.has([1, 2], "length")`, "First argument to .HAS() must be an object."],
		[`.has("kind", "kind")`, "First argument to .HAS() must be an object."],
		[`.has(cfg, 1)`, "Second argument to .HAS() (key) must be a string."],
		[`.has(cfg)`, "Function 'HAS' expects between 2 and 2 arguments, but got 1."],
	])("should reject %s", (expression, message) => {
		expect(() => evaluate(expression)).toThrow(message);
	});

	it("should test a segment's attribute in a linker script", () => {
		const assembler = newAssembler();
		assembler.assemble(".segment CODE { reloc: true, kind: $1000 }");
		const script = `
			code = .segment("CODE")
			.WRITE BYTE .has(code.attrs, "kind")
			.WRITE BYTE .has(code.attrs, "align")
			align = $100
			.IF .has(code.attrs, "align")
				align = code.attrs.align
			.END
			.WRITE LONG align
		`;
		expect(assembler.linker.link(script, undefined, new Logger({ sink: new MemorySink(), enabled: false })).data).toEqual([1, 0, 0, 1, 0, 0]);
	});
});
