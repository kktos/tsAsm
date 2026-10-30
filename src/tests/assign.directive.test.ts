import { beforeEach, describe, expect, it } from "vitest";
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

describe("= - variable assignment", () => {
	let asm: Assembler;

	beforeEach(() => {
		asm = asm = new Assembler(fakeCPU, new MockFileHandler());
	});

	it("should define a variable", () => {
		const src = "foo = 123";
		asm.assemble(src);
		const symbolName = asm.symbolTable.lookupSymbol("foo");
		expect(symbolName).toBe(123);
	});

	it("should allow to change its value", () => {
		const src = `
				foo = 123
				foo = 456
			`;
		asm.assemble(src);
		const symbolName = asm.symbolTable.lookupSymbol("foo");
		expect(symbolName).toBe(456);
	});

	it("should have a mandatory symbol name before =", () => {
		const src = `
				foo = 123
				= 456
			`;
		expect(() => asm.assemble(src)).toThrow(/Unexpected operator '='/);
	});

	it("should not work with label", () => {
		const src = `
				boo:
					= 456
			`;
		expect(() => asm.assemble(src)).toThrow("Missing symbol name before =.");
	});

	it("should point at its last assignment when it's redefined as a constant", () => {
		const src = `
				v = 1
				v = 2
				v .equ 3
			`;
		expect(() => asm.assemble(src)).toThrow(
			expect.objectContaining({
				message: "Symbol 'V' redefined.",
				notes: [expect.objectContaining({ message: "last assigned here", location: expect.objectContaining({ line: 3 }) })],
			}),
		);
	});

	// Pass 2 gets back the symbols pass 1 defined in a macro call or a procedure. Here pass 1 didn't run the assignment,
	// so pass 2 defines the variable instead of assigning it.
	it("should define a variable in a macro called in pass 2 only", () => {
		const src = `
				.macro m
					v = 5
					.byte v
				.end
				.if FWD == 1
					m
				.end
				FWD = 1
			`;
		const segments = asm.assemble(src);
		expect(segments[0]?.data).toEqual([5]);
	});

	it("should define a variable in a procedure, in a block run in pass 2 only", () => {
		const src = `
				.proc f
					.if FWD == 1
						v = 5
						.byte v
					.end
				.end
				FWD = 1
			`;
		const segments = asm.assemble(src);
		expect(segments[0]?.data).toEqual([5]);
	});
});
