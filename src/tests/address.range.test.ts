import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { AssemblerOptions } from "../assembler/polyasm.types";
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

describe("A segment's range: the CPU's address space, when it's selected", () => {
	const assemble = (source: string, options: AssemblerOptions = {}) =>
		new Assembler([new Cpu6502Handler(), new CpuRV32IHandler()], new MockFileHandler(), options).assemble(source);

	const errorOf = (source: string, options: AssemblerOptions = {}) => {
		try {
			assemble(source, options);
		} catch (e) {
			return e as AsmError;
		}
		throw new Error("expected the assembly to fail");
	};

	it("should take a segment whose last byte is at $FFFF", () => {
		const source = `
			.segment TOP { start: $FF00, size: $100 }
			.segment TOP
			nop
		`;
		expect(assemble(source)[0]?.data[0]).toBe(0xea);
	});

	it.each([
		["outside it", "{ start: $10000, size: 4 }", "Segment 'HIGH' ($10000..$10003) doesn't fit in the 6502's address space ($0..$FFFF)."],
		["ending past its top", "{ start: $FFF0, size: $100 }", "Segment 'HIGH' ($FFF0..$100EF) doesn't fit in the 6502's address space ($0..$FFFF)."],
		["growing from past its top", "{ start: $10000, size: 0 }", "Segment 'HIGH' starts at $10000, outside the 6502's address space ($0..$FFFF)."],
		["relocatable, bigger than it", "{ reloc: true, size: $10001 }", "Segment 'HIGH' is $10001 bytes, more than the 6502's address space ($0..$FFFF)."],
	])("should refuse selecting a segment %s, at the .segment, with nothing written", (_name, definition, message) => {
		const source = `
			.segment HIGH ${definition}
			.segment HIGH
		`;
		const error = errorOf(source);
		expect(error.message).toContain(message);
		expect(error.location.line).toBe(3);
	});

	it("should take a segment over $FFFF on a 32-bit CPU", () => {
		const source = `
			.cpu "RV32I"
			.segment HIGH { start: $10000, size: 4 }
			.segment HIGH
			addi a0, zero, 42
		`;
		expect(assemble(source)[0]?.data.length).toBe(4);
	});

	it("should check a segment against the CPU of where it's selected", () => {
		const source = `
			.segment HIGH { start: $10000, size: 4 }
			.segment HIGH
			.cpu "RV32I"
		`;
		expect(errorOf(source).message).toContain("Segment 'HIGH' ($10000..$10003) doesn't fit in the 6502's address space ($0..$FFFF).");
	});

	it("should check the project's first segment against the CPU the source starts with", () => {
		const segments = [{ name: "HIGH", start: 0x10000, size: 4 }];
		expect(errorOf("", { segments }).message).toContain("Segment 'HIGH' ($10000..$10003) doesn't fit in the 6502's address space ($0..$FFFF).");
		expect(assemble("", { segments, cpu: "RV32I" })[0]?.data.length).toBe(4);
	});
});
