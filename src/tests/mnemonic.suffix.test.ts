import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Cpu6809Handler } from "../cpu/cpu6809.class";
import type { CPUHandler } from "../cpu/cpuhandler.interface";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Mnemonic suffixes", () => {
	const assemble = (cpu: CPUHandler, source: string) => {
		const assembler = new Assembler(cpu, new MockFileHandler(), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
		assembler.assemble(source);
		return assembler.link();
	};

	describe.each([
		["6502", () => new Cpu6502Handler()],
		["65C02", () => new Cpu65C02Handler()],
	])("on the %s, .b forces zero page and .w absolute", (name, cpu) => {
		it.each([
			["lda.b $10", [0xa5, 0x10]],
			["lda.w $10", [0xad, 0x10, 0x00]],
			["LDA.W $10", [0xad, 0x10, 0x00]],
			["sta.w $10,x", [0x9d, 0x10, 0x00]],
			[".macro m\n lda.w $10\n.end\n m", [0xad, 0x10, 0x00]],
		])("should assemble %j", (source, bytes) => {
			expect(assemble(cpu(), source)).toEqual(bytes);
		});

		it("should size an operand defined later with the suffix", () => {
			expect(assemble(cpu(), "lda.b zp\nnext: nop\nzp = $10")).toEqual([0xa5, 0x10, 0xea]);
		});

		it("should throw when .b is given an address outside the zero page", () => {
			expect(() => assemble(cpu(), "lda.b $1234")).toThrow("Zero page address 4660 is out of range ($0..$FF).");
		});

		it("should throw on a suffix the CPU doesn't have", () => {
			expect(() => assemble(cpu(), "lda.q $10")).toThrow(`'LDA.Q': the ${name} has no '.Q' suffix (it has .B, .W).`);
		});
	});

	it("should throw on a suffix for a CPU without suffixes", () => {
		expect(() => assemble(new Cpu6809Handler(), "lda.b $10")).toThrow("'LDA.B': the 6809 has no '.B' suffix.");
	});
});
