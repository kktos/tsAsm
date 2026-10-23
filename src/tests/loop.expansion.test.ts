import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

// A loop only generates lines, like a preprocessor: what its body defines stays where the loop is.
// Only the iterators are local to the loop.
describe("Loops as line generators", () => {
	const assemble = (source: string) => {
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
		assembler.assemble(source);
		return assembler.link();
	};

	it("should keep what the body defines after the loop", () => {
		expect(assemble(".repeat 2\nz = 5\n.end\n.db z")).toEqual([5]);
		expect(assemble(".for x of [1]\nlp: nop\n.end\n jmp lp")).toEqual([0xea, 0x4c, 0x00, 0x10]);
	});

	it("should resolve a label used before its definition in the body", () => {
		expect(assemble(".repeat 1\n beq skip\n nop\nskip:\n.end")).toEqual([0xf0, 0x01, 0xea]);
	});

	it("should carry a variable over to the next iteration", () => {
		expect(assemble(".repeat 3 AS i\n.if i == 1\nx = 10\n.else\nx = x + 1\n.end\n.db x\n.end")).toEqual([0x0a, 0x0b, 0x0c]);
	});

	it.each([
		[".repeat 2\nlp: dex\n bne lp\n.end", "Symbol 'LP' redefined."],
		[".for x of [1, 2]\nlp: dex\n.end", "Symbol 'LP' redefined."],
	])("should report a label written in a body run more than once, as if the lines were written twice: %j", (source, message) => {
		expect(() => assemble(source)).toThrow(
			expect.objectContaining({ message, notes: [expect.objectContaining({ location: expect.objectContaining({ line: 2, column: 1 }) })] }),
		);
	});

	it("should branch with anonymous labels in a body run more than once", () => {
		expect(assemble(".repeat 2\n: dex\n bne :-\n.end")).toEqual([0xca, 0xd0, 0xfd, 0xca, 0xd0, 0xfd]);
	});

	it("should keep the iterators local to the loop", () => {
		expect(assemble("i = 7\n.repeat 2 AS i\n.db i\n.end\n.db i")).toEqual([1, 2, 7]);
		expect(assemble("i .equ 3\n.repeat 2 AS i\n.db i\n.end\n.db i")).toEqual([1, 2, 3]);
		expect(assemble("x = 9\nj = 8\n.for x of [5, 6] AS j\n.db x, j\n.end\n.db x, j")).toEqual([5, 0, 6, 1, 9, 8]);
		expect(() => assemble(".repeat 2 AS i\n nop\n.end\n.db i")).toThrow("Undefined symbol 'I'");
	});
});
