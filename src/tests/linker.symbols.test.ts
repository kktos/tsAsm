import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { Linker } from "../linker/linker.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** A global constant and variable, a relocatable label, and, in the namespace `gfx` where the source ends, a constant, a function and a `.proc`. */
const SOURCE = `
	VERSION = $0102
	count = 1
	count = 2
	NAME .equ "GAME"
	.segment CODE { reloc: true }
	.segment CODE
	nop
main:
	rts
	.namespace gfx
	TILES = $40
	.function double(x) = x * 2
	.proc draw
loop:
	nop
	.end
`;

const logger = () => new Logger({ sink: new MemorySink(), enabled: false });

/** The output of the linker `script`, after assembling `source`. */
function link(script: string, source = SOURCE) {
	const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), { logger: logger() });
	assembler.assemble(source);
	return assembler.linker.link(script, undefined, logger()).data;
}

describe("The source's symbols in the linker script", () => {
	it("should read a global symbol, in any case, whatever namespace the source ends in", () => {
		expect(link(`.WRITE WORD .symbol("version")\n.WRITE WORD .symbol("global::VERSION")\n.WRITE STRING .symbol("Name")`)).toEqual([
			0x02, 0x01, 0x02, 0x01, 0x47, 0x41, 0x4d, 0x45,
		]);
	});

	it("should read a variable's last value", () => {
		expect(link(`.WRITE BYTE .symbol("count")`)).toEqual([0x02]);
	});

	it("should read a namespace's symbol as ns::name", () => {
		expect(link(`.WRITE BYTE .symbol("gfx::TILES")`)).toEqual([0x40]);
	});

	it("should take a name computed in the script", () => {
		expect(link(`ns = "gfx"\n.WRITE BYTE .symbol(ns + "::tiles")`)).toEqual([0x40]);
	});

	it("should give a relocatable label as it is: its segment and offset readable, not a number", () => {
		expect(link(`m = .symbol("main")\nnext = m + 2\n.WRITE BYTE m.offset\n.WRITE STRING m.segment\n.WRITE BYTE next.offset`)).toEqual([
			0x01, 0x43, 0x4f, 0x44, 0x45, 0x03,
		]);
		expect(() => link(`.WRITE WORD .symbol("main")`)).toThrow(
			"CODE+$0001 is relocatable: its address is only known when it's loaded, and a number is needed here.",
		);
	});

	it.each([
		[`.symbol("nope")`, "Symbol 'nope' isn't defined in the source."],
		// in a namespace, it needs its name
		[`.symbol("TILES")`, "Symbol 'TILES' isn't defined in the source."],
		// a .proc's labels are local to it
		[`.symbol("gfx::loop")`, "Symbol 'gfx::loop' isn't defined in the source."],
		[`.symbol("gfx::double")`, "'gfx::double' is a function of the source: .SYMBOL() reads a value."],
		[`.symbol(1)`, "Argument to .SYMBOL() must be a string."],
	])("should reject %s", (call, message) => {
		expect(() => link(`.WRITE WORD ${call}`)).toThrow(message);
	});

	it("should locate its error at the call", () => {
		expect(() => link(`.OUTPUT "out.bin"\n.WRITE WORD .symbol("nope")`)).toThrow(
			expect.objectContaining({ location: expect.objectContaining({ line: 2, column: 14 }) }),
		);
	});

	it("should find no symbol in a linker without an assembler", () => {
		expect(() => new Linker(0).link(`.WRITE WORD .symbol("main")`, undefined, logger())).toThrow("Symbol 'main' isn't defined in the source.");
	});

	it("should not exist in the source", () => {
		expect(() => link("", `.db .symbol("VERSION")`)).toThrow("Unknown function 'SYMBOL'.");
	});
});
