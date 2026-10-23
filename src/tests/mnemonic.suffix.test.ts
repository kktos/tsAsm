import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Cpu6809Handler } from "../cpu/cpu6809.class";
import type { CPUHandler } from "../cpu/cpuhandler.interface";
import { MockFileHandler } from "./mockfilehandler.class";

// A suffix tells the assembler the addressing mode the developer wants: .b zero page, .w absolute.
describe("Mnemonic suffixes", () => {
	const assemble = (cpu: CPUHandler, source: string) => {
		const assembler = new Assembler(cpu, new MockFileHandler(), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
		assembler.assemble(source);
		return assembler.link();
	};

	describe.each([
		["6502", () => new Cpu6502Handler()],
		["65C02", () => new Cpu65C02Handler()],
	])("on the %s", (name, cpu) => {
		it.each([
			["X = $10\nlda X", [0xa5, 0x10]],
			["X = $10\nlda.w X", [0xad, 0x10, 0x00]],
			["X = $1234\nlda.b X", [0xa5, 0x34]],
			["LDA.W $10", [0xad, 0x10, 0x00]],
			["sta.w $10,x", [0x9d, 0x10, 0x00]],
			["sta.b $1234,x", [0x95, 0x34]],
			["ldx.b $1234,y", [0xb6, 0x34]],
			["jmp.w $10", [0x4c, 0x10, 0x00]],
			[".macro m\n lda.w $10\n.end\n m", [0xad, 0x10, 0x00]],
		])("should assemble %j", (source, bytes) => {
			expect(assemble(cpu(), source)).toEqual(bytes);
		});

		it("should size an address defined later with the suffix", () => {
			expect(assemble(cpu(), "lda.b zp\nnext: nop\nzp = $10")).toEqual([0xa5, 0x10, 0xea]);
			expect(assemble(cpu(), "lda.w later\nlater = 5")).toEqual([0xad, 0x05, 0x00]);
		});

		it.each(["nop.b", "lda.w #1", "asl.b a", "lda.b ($10),y", "bne.w next\nnext: nop"])(
			"should throw on a suffix for an operand that isn't a zero page or absolute address: %j",
			(source) => {
				const suffix = source.split(/[ \n]/)[0]?.split(".")[1]?.toUpperCase();
				expect(() => assemble(cpu(), source)).toThrow(`.${suffix} only applies to an address that can be zero page or absolute.`);
			},
		);

		it.each([
			["jmp.b $10", "'JMP.B': JMP has no zero page form."],
			["lda.b $10,y", "'LDA.B': LDA has no zero page,Y form."],
			["stx.w $10,y", "'STX.W': STX has no absolute,Y form."],
		])("should throw when the instruction has no such form: %j", (source, message) => {
			expect(() => assemble(cpu(), source)).toThrow(message);
		});

		it("should choose absolute,Y when there's no zero page,Y form", () => {
			expect(assemble(cpu(), "lda $10,y")).toEqual([0xb9, 0x10, 0x00]);
			expect(() => assemble(cpu(), "stx $1234,y")).toThrow("STX has no absolute,Y form, and $1234 isn't a zero page address.");
		});

		it("should throw on a suffix the CPU doesn't have", () => {
			expect(() => assemble(cpu(), "lda.q $10")).toThrow(`'LDA.Q': the ${name} has no '.Q' suffix (it has .B, .W).`);
		});
	});

	it("should throw on a suffix for a CPU without suffixes", () => {
		expect(() => assemble(new Cpu6809Handler(), "lda.b $10")).toThrow("'LDA.B': the 6809 has no '.B' suffix.");
	});
});
