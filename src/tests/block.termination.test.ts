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
		[" nop\n.if 1\n nop", "Missing .END for the .IF block.", 2],
		[".if 1\n nop\n.else\n rts", "Missing .END for the .ELSE block.", 3],
		[".repeat 2\n nop", "Missing .END for the .REPEAT block.", 1],
		[".macro m\n nop", "Missing .END for the .MACRO block.", 1],
		[".proc f\n rts", "Missing .END for the .PROC block.", 1],
		[".hex\n 01 02", "Missing .END for the .HEX block.", 1],
		// the .end closes the inner .repeat: the .if is the one left open
		[".if 1\n.repeat 2\n nop\n.end", "Missing .END for the .IF block.", 1],
	])("should throw when the .END is missing, at the block's line: %s", (source, message, line) => {
		expect(() => assemble(source)).toThrow(expect.objectContaining({ message: message, location: expect.objectContaining({ line }) }));
	});

	it("should still assemble terminated and nested blocks", () => {
		expect(assemble(".if 1\n.repeat 2\n nop\n.end\n.end\n.if 0\n nop\n.else\n rts\n.end")).toEqual([0xea, 0xea, 0x60]);
	});

	it.each([
		["without operand", "{ nop }", [0xea]],
		["in nested blocks", "{ { nop } }", [0xea]],
		["followed by a block", "{ nop } { rts }", [0xea, 0x60]],
		["on the accumulator", "{ asl a }", [0x0a]],
		["with an operand", "{ lda 1 }", [0xa5, 0x01]],
	])("should end an instruction %s at the '}' of a block on its line", (_, source, bytes) => {
		expect(assemble(source)).toEqual(bytes);
	});

	it.each([
		["without argument", "{ .once }", []],
		["missing its argument", "{ .org }", "Missing expression."],
	])("should end a directive %s at the '}' of a block on its line", (_, source, expected) => {
		if (typeof expected === "string") expect(() => assemble(source)).toThrow(expected);
		else expect(assemble(source)).toEqual(expected);
	});

	it("should reject a '}' that closes no block after an instruction", () => {
		expect(() => assemble("nop }")).toThrow("Syntax error : Unbalanced braces. Depth: -1");
	});
});
