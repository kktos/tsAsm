import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { MockFileHandler } from "./mockfilehandler.class";

// Minimal fake CPU handler
const fakeCPU = {
	cpuType: "6502" as const,
	isInstruction: () => false,
	resolveAddressingMode: () => ({
		mode: "",
		opcode: 0,
		bytes: 0,
		resolvedAddress: 0,
	}),
	encodeInstruction: () => [],
	endianness: "little" as const,
	addressBits: 16,
};

function makeAssembler() {
	const asm = new Assembler(fakeCPU, new MockFileHandler());
	return { asm };
}

describe(".LET directive", () => {
	describe("static name", () => {
		it("should define a symbol with a value", () => {
			const { asm } = makeAssembler();
			const src = ".LET foo = 123";
			asm.assemble(src);
			const symbol = asm.symbolTable.lookupSymbol("foo");
			expect(symbol).toBe(123);
		});

		it("should allow forward references", () => {
			const { asm } = makeAssembler();
			const src = `
			.LET foo = bar
			bar = 10
		`;
			asm.assemble(src);
			const symbol = asm.symbolTable.lookupSymbol("foo");
			expect(symbol).toBe(10);
		});

		it("should throw an error when re-defining a constant with .LET", () => {
			const { asm } = makeAssembler();
			const src = `
			foo .EQU 10
			.LET foo = 20
		`;
			expect(() => asm.assemble(src)).toThrow(
				expect.objectContaining({
					message: "Can't redefine constant 'FOO'.",
					notes: [
						expect.objectContaining({
							message: "defined here",
							location: expect.objectContaining({ line: 2 }),
						}),
					],
				}),
			);
		});

		it("should allow re-defining a variable with .LET", () => {
			const { asm } = makeAssembler();
			const src = `
			foo = 10
			.LET foo = 20
		`;
			asm.assemble(src);
			const symbolBar = asm.symbolTable.lookupSymbol("foo");
			expect(symbolBar).toBe(20);
		});

		it("should throw an error when re-defining a .LET variable as a constant", () => {
			const { asm } = makeAssembler();
			const src = `
			.LET foo = 10
			foo .EQU 20
		`;
			expect(() => asm.assemble(src)).toThrow(
				expect.objectContaining({
					message: "Symbol 'FOO' redefined.",
					notes: [
						expect.objectContaining({
							message: "first defined here",
							location: expect.objectContaining({ line: 2 }),
						}),
					],
				}),
			);
		});

		it("should handle complex expressions", () => {
			const { asm } = makeAssembler();
			const src = `
			.LET foo = 10 + 5
			.LET bar = foo * 2
		`;
			asm.assemble(src);
			const symbolBar = asm.symbolTable.lookupSymbol("bar");
			expect(symbolBar).toBe(30);
		});

		it("should handle strings", () => {
			const { asm } = makeAssembler();
			const src = `.LET name = "hello"`;
			asm.assemble(src);
			const symbolName = asm.symbolTable.lookupSymbol("name");
			expect(symbolName).toBe("hello");
		});

		it("should index an array literal", () => {
			const { asm } = makeAssembler();
			asm.assemble(".LET v = [1,2][1]");
			expect(asm.symbolTable.lookupSymbol("v")).toBe(2);
		});
	});

	describe("dynamic name", () => {
		it("should handle name as strings concatenation", () => {
			const { asm } = makeAssembler();
			const src = `.LET ("na")+("me") = "hello"`;
			asm.assemble(src);
			const symbolName = asm.symbolTable.lookupSymbol("name");
			expect(symbolName).toBe("hello");
		});

		it("should not allow operator = in name expression", () => {
			const { asm } = makeAssembler();
			const src = `.LET ("na")+("me"="") = "hello"`;
			expect(() => asm.assemble(src)).toThrow(/.LET expression only allows operator "==" to test equality/);
		});

		it("should allow operator == in name expression", () => {
			const { asm } = makeAssembler();
			const src = `.LET ("na")+.iif("me"=="","yes","no") = "hello"`;
			asm.assemble(src);
			const symbolName = asm.symbolTable.lookupSymbol("nano");
			expect(symbolName).toBe("hello");
		});

		it("should allow only valid identifers in name expression", () => {
			const { asm } = makeAssembler();
			const src = `.LET "123" = "hello"`;
			expect(() => asm.assemble(src)).toThrow("Invalid identifier for symbol name: 123.");
		});

		it("should allow only valid identifers in name expression 2", () => {
			const { asm } = makeAssembler();
			const src = `.LET "n@me" = "hello"`;
			expect(() => asm.assemble(src)).toThrow("Invalid identifier for symbol name: n@me.");
		});
	});
});
