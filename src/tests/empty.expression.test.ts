import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Cpu6809Handler } from "../cpu/cpu6809.class";
import { CpuArmRiscHandler } from "../cpu/cpuarm.class";
import type { CPUHandler } from "../cpu/cpuhandler.interface";
import { CpuRV32IHandler } from "../cpu/cpurv32i.class";
import { AsmError } from "../utils/error.utils";
import { MockFileHandler } from "./mockfilehandler.class";

// An empty expression is an error, not 0: `lda #` doesn't assemble `lda #0`.
describe("An empty expression", () => {
	const assemble = (cpu: CPUHandler, source: string) => {
		const assembler = new Assembler(cpu, new MockFileHandler(), {
			segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		});
		try {
			assembler.assemble(source);
		} catch (e) {
			return e as AsmError;
		}
		throw new Error("expected the assembly to fail");
	};

	it.each([
		["6502", () => new Cpu6502Handler(), "  nop\n  lda #"],
		["65C02", () => new Cpu65C02Handler(), "  nop\n  lda #"],
		["6809", () => new Cpu6809Handler(), "  nop\n  ldd #"],
		["ARM", () => new CpuArmRiscHandler(), "  nop\n  mov r0, #"],
		["RV32I", () => new CpuRV32IHandler(), "  nop\n  addi x1, x2,"],
	])("should be an error in a %s immediate operand", (_, cpu, source) => {
		const error = assemble(cpu(), source);
		expect(error.message).toBe("Missing expression.");
		expect(error.location).toMatchObject({ line: 2, column: 3 });
	});

	it.each(["lda ,x", "lda (),y", "lda (,x)", "jmp ()"])("should be an error in the 6502 operand %j", (source) => {
		expect(assemble(new Cpu6502Handler(), source).message).toBe("Missing expression.");
	});

	it.each([
		"x =",
		"x .equ",
		".let x =",
		".db 1,",
		".dw",
		".fill",
		".res",
		".org",
		".align",
		`.if
		nop
		.end`,
	])("should be an error in %j", (source) => {
		expect(assemble(new Cpu6502Handler(), source).message).toBe("Missing expression.");
	});

	// An array element is an expression too: `[1,,2]` isn't `[1, 2]`.
	it.each(["list = [1,,2]", "list = [1,]", "list = [,]", "list = [,1]", "list = [[1,],2]"])("should be an error as an array element in %j", (source) => {
		expect(assemble(new Cpu6502Handler(), source).message).toBe("Missing expression.");
	});

	// So is a function argument: `.array(1,,2)` isn't an internal error, `.len("ab",)` isn't 2 arguments.
	it.each([
		["list = .array(1,,2)", 17],
		["list = .array(1,)", 17],
		["list = .array(,1)", 15],
		["list = .array(,)", 15],
		[`.db .len("ab",)`, 15],
		[".db (1,)", 8],
	])("should be an error as a function argument in %j", (source, column) => {
		const error = assemble(new Cpu6502Handler(), source);
		expect(error.message).toBe("Missing expression.");
		expect(error.location).toMatchObject({ line: 1, column });
	});

	it("should still allow a call without arguments", () => {
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
			segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		});
		assembler.assemble(`
			list = .array()
			.db .len(list)
		`);
		expect(assembler.link()).toEqual([0]);
	});

	it("should still allow an empty array", () => {
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
			segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		});
		assembler.assemble(`
			list = []
			.db .len(list)
		`);
		expect(assembler.link()).toEqual([0]);
	});
});
