import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Block termination", () => {
	const assemble = (source: string) => {
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler());
		assembler.assemble(source);
		return assembler.link();
	};

	it.each([
		[" nop\n.if 1\n nop", "Missing .END for the .IF block on line 2."],
		[".if 1\n nop\n.else\n rts", "Missing .END for the .ELSE block on line 3."],
		[".repeat 2\n nop", "Missing .END for the .REPEAT block on line 1."],
		[".macro m\n nop", "Missing .END for the .MACRO block on line 1."],
		[".function f\n rts", "Missing .END for the .FUNCTION block on line 1."],
		[".hex\n 01 02", "Missing .END for the .HEX block on line 1."],
		// the .end closes the inner .repeat: the .if is the one left open
		[".if 1\n.repeat 2\n nop\n.end", "Missing .END for the .IF block on line 1."],
	])("should throw when the .END is missing: %s", (source, message) => {
		expect(() => assemble(source)).toThrow(message);
	});

	it("should still assemble terminated and nested blocks", () => {
		expect(assemble(".if 1\n.repeat 2\n nop\n.end\n.end\n.if 0\n nop\n.else\n rts\n.end")).toEqual([0xea, 0xea, 0x60]);
	});
});
