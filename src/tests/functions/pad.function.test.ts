import { describe, expect, it } from "vitest";
import { Assembler } from "../../assembler/polyasm";
import { Logger } from "../../helpers/logger.class";
import { MemorySink } from "../../helpers/memorysink.class";
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
};

describe("Function PAD()", () => {
	const setup = () => {
		const assembler = new Assembler(fakeCPU, new MockFileHandler());
		const { symbolTable, expressionEvaluator: evaluator } = assembler;
		const tokenize = (expr: string) => assembler.parser.lexer.tokenize(expr).filter((t) => t.type !== "EOF");
		const evaluate = (expr: string) => evaluator.evaluate(tokenize(expr), { PC: { value: 0 } });
		return { symbolTable, evaluate };
	};

	it("right-aligns with a positive width", () => {
		const { evaluate } = setup();
		expect(evaluate('.PAD("AB", 5)')).toBe("   AB");
	});

	it("left-aligns with a negative width", () => {
		const { evaluate } = setup();
		expect(evaluate('.PAD("AB", -5)')).toBe("AB   ");
	});

	it("pads a number as its decimal string", () => {
		const { evaluate } = setup();
		expect(evaluate(".PAD(25, 4)")).toBe("  25");
	});

	it("pads the result of .HEX()", () => {
		const { evaluate } = setup();
		expect(evaluate(".PAD(.HEX(7, 4), -7)")).toBe("$0007  ");
	});

	it("pads a string symbol", () => {
		const { evaluate, symbolTable } = setup();
		symbolTable.defineVariable("name", "INTRO", { filename: "test", line: 1, column: 1 });
		expect(evaluate(".PAD(name, -8)")).toBe("INTRO   ");
	});

	it("uses the fill character", () => {
		const { evaluate } = setup();
		expect(evaluate('.PAD(42, 6, "0")')).toBe("000042");
		expect(evaluate('.PAD("NAME", -8, ".")')).toBe("NAME....");
	});

	it("never truncates a value wider than the width", () => {
		const { evaluate } = setup();
		expect(evaluate('.PAD("WELCOME.DATA", 4)')).toBe("WELCOME.DATA");
		expect(evaluate('.PAD("WELCOME.DATA", -4)')).toBe("WELCOME.DATA");
	});

	it("leaves the value as is with a width of 0", () => {
		const { evaluate } = setup();
		expect(evaluate('.PAD("AB", 0)')).toBe("AB");
	});

	it("fails on a value that is neither a string nor a number", () => {
		const { evaluate } = setup();
		expect(() => evaluate(".PAD([1, 2], 5)")).toThrow("First argument to .PAD() must be a string or a number.");
	});

	it("fails on a width that is not an integer", () => {
		const { evaluate } = setup();
		expect(() => evaluate('.PAD("AB", "5")')).toThrow("Second argument to .PAD() (width) must be an integer.");
		expect(() => evaluate('.PAD("AB", 5/2)')).toThrow("Second argument to .PAD() (width) must be an integer.");
	});

	it("fails on a fill that is not a single character", () => {
		const { evaluate } = setup();
		expect(() => evaluate('.PAD("AB", 5, "")')).toThrow("Third argument to .PAD() (fill) must be a single character.");
		expect(() => evaluate('.PAD("AB", 5, "--")')).toThrow("Third argument to .PAD() (fill) must be a single character.");
		expect(() => evaluate('.PAD("AB", 5, 0)')).toThrow("Third argument to .PAD() (fill) must be a single character.");
	});

	it("fails with a missing width", () => {
		const { evaluate } = setup();
		expect(() => evaluate('.PAD("AB")')).toThrow("Function 'PAD' expects between 2 and 3 arguments, but got 1.");
	});

	it("lines up the columns of a .LOG table", () => {
		const sink = new MemorySink();
		const assembler = new Assembler(fakeCPU, new MockFileHandler(), {
			logger: new Logger({ sink, enabled: true }),
			log: { pass1Enabled: false, pass2Enabled: true },
		});
		assembler.assemble(`
			.log .pad("#", -4) + .pad("Size", -7) + "Name"
			.log .pad(.hex(2), -4) + .pad(.hex($200, 4), -7) + "WELCOME"
			.log .pad(.hex(3), -4) + .pad(.hex($1000, 4), -7) + "WELCOME.DATA"
		`);

		const header = sink.logs.indexOf("#   Size   Name");
		const table = sink.logs.slice(header, header + 3);
		expect(table).toEqual(["#   Size   Name", "$02 $0200  WELCOME", "$03 $1000  WELCOME.DATA"]);
	});
});
