import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** Two relocatable segments, CODE and DATA, and a fixed one, FIXED at $1000: the source starts in CODE. */
const SEGMENTS = `
	.segment CODE { reloc: true }
	.segment DATA { reloc: true }
	.segment FIXED { start: $1000, size: 0 }
	.segment CODE
`;

function newAssembler(sink = new MemorySink()) {
	return new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
		logger: new Logger({ sink, enabled: true }),
		log: { pass2Enabled: true },
	});
}

/** The symbol file's global namespace after assembling `source`, without where each symbol is defined. */
function symbolsOf(source: string) {
	const assembler = newAssembler();
	assembler.assemble(SEGMENTS + source);
	const globals = assembler.symbolTable.getDict().global ?? {};
	return Object.fromEntries(Object.entries(globals).map(([name, line]) => [name, String(line).replace(/ ;.*/, "")]));
}

const assemble = (source: string) => newAssembler().assemble(SEGMENTS + source);

describe("Relocatable values", () => {
	describe("a label in a relocatable segment", () => {
		it("should be its segment and its offset there", () => {
			const symbols = symbolsOf(`
				nop
			main:
				nop
			:loop
				.segment DATA
			msg:
				.segment FIXED
			fixed:
			`);
			expect(symbols).toMatchObject({
				MAIN: "label reloc = CODE+$0001",
				"MAIN.LOOP": "label reloc = CODE+$0002",
				MSG: "label reloc = DATA+$0000",
				FIXED: "label number = $1000",
			});
		});

		it("should be one for a .proc's name", () => {
			expect(symbolsOf(`nop\n.proc clear\nnop\n.end proc`)).toMatchObject({ CLEAR: "label reloc = CODE+$0001" });
		});

		it("should make * and .PC relocatable", () => {
			expect(symbolsOf(`nop\nhere = *\npc = .pc`)).toMatchObject({ HERE: "var reloc = CODE+$0001", PC: "var reloc = CODE+$0001" });
		});

		it("should keep the anonymous labels' addresses relocatable", () => {
			expect(symbolsOf(`nop\n:\nback = :-`)).toMatchObject({ BACK: "var reloc = CODE+$0001" });
		});
	});

	describe("through expressions", () => {
		it("should stay relocatable with + n, n + and - n", () => {
			const symbols = symbolsOf(`
				nop
			main:
				nop
			a = main + 2
			b = 2 + main
			c = main - 3
			d = a + 1 - 1
			`);
			expect(symbols).toMatchObject({
				A: "var reloc = CODE+$0003",
				B: "var reloc = CODE+$0003",
				C: "var reloc = CODE-$0002",
				D: "var reloc = CODE+$0003",
			});
		});

		it("should give a number for the difference of two labels of the same segment, a forward one too", () => {
			const symbols = symbolsOf(`
			start:
			size = end - start
				nop
				nop
			end:
			`);
			expect(symbols).toMatchObject({ SIZE: "var number = $02" });
		});

		it("should take one byte with <, >, ^ and their functions", () => {
			const symbols = symbolsOf(`
				nop
			main:
			lo = <main
			hi = >main
			bank = ^main
			lo2 = .lobyte(main)
			hi2 = .hibyte(main)
			bank2 = .bankbyte(main)
			`);
			expect(symbols).toMatchObject({
				LO: "var reloc = <CODE+$0001",
				HI: "var reloc = >CODE+$0001",
				BANK: "var reloc = ^CODE+$0001",
				LO2: "var reloc = <CODE+$0001",
				HI2: "var reloc = >CODE+$0001",
				BANK2: "var reloc = ^CODE+$0001",
			});
		});

		it("should keep them in arrays", () => {
			expect(symbolsOf(`main:\nlist = [main, 1]`)).toMatchObject({ LIST: 'var array = ["CODE+$0000",1]' });
		});

		it.each([
			["main * 2", "Operator '*' can't take CODE+$0000, a relocatable value: it only takes + n, - n, - a label of its segment, and <, > or ^."],
			["main & $FF", "Operator '&' can't take CODE+$0000"],
			["main = 0", "Operator '=' can't take CODE+$0000"],
			["main < here", "Operator '<' can't take CODE+$0000"],
			["main + main", "Operator '+' can't take CODE+$0000"],
			["1 - main", "Operator '-' can't take CODE+$0000"],
			["-main", "Operator '-' can't take CODE+$0000"],
			["!main", "Operator '!' can't take CODE+$0000"],
			["main && 1", "Operator '&&' can't take CODE+$0000"],
			["<main + 1", "Operator '+' can't take <CODE+$0000"],
			["<main - <main", "Operator '-' can't take <CODE+$0000"],
			["<(<main)", "'<' can't take <CODE+$0000: it's already one byte of a relocatable value."],
			[".lobyte(>main)", ".LOBYTE() can't take >CODE+$0000: it's already one byte of a relocatable value."],
			["msg - main", "DATA+$0000 - CODE+$0000: two relocatable segments are a distance apart only known when they're loaded."],
			["fixed - main", "Operator '-' can't take CODE+$0000"],
			[".hex(main)", ".HEX() can't take CODE+$0000, a relocatable value: it only takes + n, - n, - a label of its segment, and <, > or ^."],
			[".str(main)", ".STR() can't take CODE+$0000"],
			[".json(main)", ".JSON() can't take CODE+$0000"],
			[".type(main)", ".TYPE() can't take CODE+$0000"],
			["main.segment", "Invalid property access on a non-object value."],
		])("should reject %s", (expression, message) => {
			expect(() =>
				assemble(`
				main:
				here:
					.segment DATA
				msg:
					.segment FIXED
				fixed:
				x = ${expression}
				`),
			).toThrow(message);
		});

		it("should locate an operator's error at the operator", () => {
			expect(() => assemble(`main:\nx = 1 + main * 2`)).toThrow(expect.objectContaining({ location: expect.objectContaining({ line: 7, column: 14 }) }));
		});
	});

	describe("where a number is needed", () => {
		it.each([
			[".if main\n.end", "CODE+$0000 is relocatable: its address is only known when it's loaded, and a number is needed here."],
			[".assert main", "CODE+$0000 is relocatable"],
			[".repeat main\n.end", "CODE+$0000 is relocatable"],
			[".fill main", "CODE+$0000 is relocatable"],
			[".align main", "CODE+$0000 is relocatable"],
			[".segment FIXED\n.org main", "CODE+$0000 is relocatable"],
			[".segment S { start: main, size: 1 }", "CODE+$0000 is relocatable"],
			["x = .iif(main, 1, 2)", "First argument to .IIF() must be a number."],
		])("should reject %s", (statement, message) => {
			expect(() => assemble(`main:\n${statement}`)).toThrow(message);
		});

		it("should keep .iif's values relocatable", () => {
			expect(symbolsOf(`main:\nx = .iif(1, main, 0)`)).toMatchObject({ X: "var reloc = CODE+$0000" });
		});
	});

	describe("listing", () => {
		it("should show a label's segment and offset", () => {
			const sink = new MemorySink();
			newAssembler(sink).assemble(`${SEGMENTS}\nnop\nmain:\n:\nx = main + 1`);
			const lines = sink.logs.map((line) => String(line).replace(/\s+/g, " ").trim());
			expect(lines).toEqual(expect.arrayContaining(["CODE+0001 main:", "CODE+0001 :", "X = CODE+$0002"]));
		});

		it("should start the name where a fixed label's starts", () => {
			const sink = new MemorySink();
			newAssembler(sink).assemble(`${SEGMENTS}\nmain:\n.segment FIXED\nfixed:`);
			const lines = sink.logs.map(String);
			const main = lines.find((line) => line.endsWith("main:")) ?? "";
			const fixed = lines.find((line) => line.endsWith("fixed:")) ?? "";
			expect(main.indexOf("main:")).toBe(fixed.indexOf("fixed:"));
		});
	});

	describe("linking without a script", () => {
		it("should reject a relocatable segment", () => {
			const assembler = newAssembler();
			assembler.assemble(`${SEGMENTS}\nnop`);
			expect(() => assembler.link()).toThrow("Segment 'CODE' is relocatable: it needs a linker script to place it.");
		});

		it("should ignore an empty one", () => {
			const assembler = newAssembler();
			assembler.assemble(`${SEGMENTS}\n.segment FIXED\nnop`);
			expect(assembler.link()).toEqual([0xea]);
		});
	});
});
