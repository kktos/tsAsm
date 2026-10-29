import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

const assemble = (source: string) => {
	const asm = new Assembler(new Cpu6502Handler(), new MockFileHandler(), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
	asm.assemble(source);
	return asm.link();
};

/** The error assembling `source` throws, at `line` and `column`. */
const errorAt = (message: string, line: number, column: number) => expect.objectContaining({ message, location: expect.objectContaining({ line, column }) });

const CALL_AT_START = `'.str(' is a function call, it can't start a statement: a directive is followed by a space, '.str ('.`;

describe("A directive: '.' glued to its name, then a space", () => {
	it.each([
		['.str "A"', [0x41]],
		['.str  "A"', [0x41]],
		['.str\t"A"', [0x41]],
		['.str ("A")', [0x41]],
		[".db $41 ; a comment", [0x41]],
		[".db $41\n.db $42", [0x41, 0x42]],
		[".hex 41", [0x41]],
		[".hex { 41 }", [0x41]],
	])("should read %j", (source, bytes) => {
		expect(assemble(source)).toEqual(bytes);
	});

	it("should read a directive alone on its line, or before a comment", () => {
		expect(assemble(".if 1\n.db 1\n.end;done\n.if 1 { .db 2 }")).toEqual([1, 2]);
	});

	it.each([
		['.str("A")', CALL_AT_START, 2],
		['.str"A"', `Expected a space after the directive name '.str', got '"'.`, 2],
		[".db$41", `Expected a space after the directive name '.db', got '$'.`, 2],
		[".hex(41)", `'.hex(' is a function call, it can't start a statement: a directive is followed by a space, '.hex ('.`, 2],
	])("should reject %j", (source, message, column) => {
		expect(() => assemble(source)).toThrow(errorAt(message, 1, column));
	});

	it("should reject a space between '.' and the name", () => {
		expect(() => assemble('. str "A"')).toThrow(errorAt(`Expected a directive name right after '.', not a space: '.str'.`, 1, 1));
	});

	it.each([
		["a macro body", '.macro m\n.str("A")\n.end\nm'],
		["a loop body", '.repeat 2\n.str("A")\n.end'],
		["an .if block", '.if 1\n.str("A")\n.end'],
		["a braced block", '.if 1 {\n.str("A")\n}'],
	])("should reject a call starting a statement in %s", (_, source) => {
		expect(() => assemble(source)).toThrow(CALL_AT_START);
	});

	it("should reject a call starting a statement in a function body", () => {
		expect(() => assemble('.function f()\n.str("A")\n.return 1\n.end\n.db f()')).toThrow(CALL_AT_START);
	});

	it("should keep reading a .hex block after a label", () => {
		expect(assemble("data: .hex 41 42")).toEqual([0x41, 0x42]);
	});
});

describe("A system function: '.', its name and '(' glued", () => {
	it.each([
		['.db .len("AB")', [2]],
		[".str .hex(10)", [0x24, 0x30, 0x41]],
		['.db .len("AB") + .len("C")', [3]],
	])("should call %j", (source, bytes) => {
		expect(assemble(source)).toEqual(bytes);
	});

	it("should reject a space before the '('", () => {
		expect(() => assemble('.db .len ("AB")')).toThrow(errorAt("No space allowed between the function '.len' and its '(': call it as .len(…).", 1, 10));
	});

	it("should reject a space after the '.'", () => {
		expect(() => assemble('.db . len("AB")')).toThrow(errorAt("Expected a name right after '.', not a space: '.len'.", 1, 5));
	});

	it("should reject a space after the '.' of a system variable", () => {
		expect(() => assemble(".db . pc")).toThrow("Expected a name right after '.', not a space: '.pc'.");
	});
});
