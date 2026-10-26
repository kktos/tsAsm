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
});
