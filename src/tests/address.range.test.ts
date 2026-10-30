import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { CpuRV32IHandler } from "../cpu/cpurv32i.class";
import { AsmError } from "../utils/error.utils";
import { MockFileHandler } from "./mockfilehandler.class";

describe("The PC's range: the CPU's address space", () => {
	const assemble = (source: string) => {
		const assembler = new Assembler([new Cpu6502Handler(), new CpuRV32IHandler()], new MockFileHandler(), {
			segments: [{ name: "CODE", start: 0, size: 0, resizable: true }],
		});
		return assembler.assemble(source);
	};

	const errorOf = (source: string) => {
		try {
			assemble(source);
		} catch (e) {
			return e as AsmError;
		}
		throw new Error("expected the assembly to fail");
	};

	it("should take code whose last byte is at $FFFF", () => {
		const source = `
			.org $FFFE
			.dw $1234
		`;
		const data = assemble(source)[0]?.data ?? [];
		expect(data.slice(0xfffe)).toEqual([0x34, 0x12]);
	});

	it.each([
		[".org $10000", "Address $10000 is outside the 6502's address space ($0..$FFFF)."],
		[".org -1", "Address -1 is outside the 6502's address space ($0..$FFFF)."],
		["* = $10000", "Address $10000 is outside the 6502's address space ($0..$FFFF)."],
	])("should refuse %j", (source, message) => {
		expect(errorOf(source).message).toContain(message);
	});

	it("should refuse a statement writing past $FFFF, at that statement", () => {
		const source = `
			.org $FFFE
			nop
			lda $1234
		`;
		const error = errorOf(source);
		expect(error.message).toContain("The PC goes past $FFFF, the top of the 6502's address space, to $10002.");
		expect(error.location.line).toBe(4);
	});

	it.each([
		[".fill", ".fill 3"],
		[".hex", ".hex 01 02 03"],
		[".text", '.text "abc"'],
	])("should refuse %s going past $FFFF", (_name, statement) => {
		const source = `
			.org $FFFE
			${statement}
		`;
		expect(errorOf(source).message).toContain("The PC goes past $FFFF");
	});

	it("should take an address over $FFFF on a 32-bit CPU", () => {
		const source = `
			.cpu "RV32I"
			.org $10000
			addi a0, zero, 42
		`;
		expect(assemble(source)[0]?.data.length).toBe(0x10004);
	});

	it("should check the PC against the CPU switched to", () => {
		const source = `
			.cpu "RV32I"
			.org $20000
			.cpu "6502"
		`;
		const error = errorOf(source);
		expect(error.message).toContain("The PC goes past $FFFF, the top of the 6502's address space, to $20000.");
		expect(error.location.line).toBe(4);
	});
});
