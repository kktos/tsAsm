import { describe, expect, it } from "vitest";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Cpu6809Handler } from "../cpu/cpu6809.class";
import { Cpu65816Handler } from "../cpu/cpu65816.class";
import { CpuArmRiscHandler } from "../cpu/cpuarm.class";
import type { CPUHandler, InstructionForm } from "../cpu/cpuhandler.interface";
import { CpuRV32IHandler } from "../cpu/cpurv32i.class";

/** The forms, in short: `operands mode opcode size`. */
const forms = (list: InstructionForm[]) =>
	list.map(({ operands, mode, opcode, fields, size: [least, most] }) =>
		[operands || "-", mode, fields ?? opcode.map((byte) => byte.toString(16)).join(" "), least === most ? least : `${least}-${most}`].join(" "),
	);

describe("CPUHandler.describeInstruction", () => {
	it("gives a 65xx mnemonic's modes, in any case, its own CPU's only", () => {
		expect(forms(new Cpu6502Handler().describeInstruction("lda"))).toEqual([
			"#$12 IMMEDIATE a9 2",
			"$12 ZEROPAGE a5 2",
			"$12,X ZEROPAGE_X b5 2",
			"$1234 ABSOLUTE ad 3",
			"$1234,X ABSOLUTE_X bd 3",
			"$1234,Y ABSOLUTE_Y b9 3",
			"($12,X) INDIRECT_X a1 2",
			"($12),Y INDIRECT_Y b1 2",
		]);
		expect(forms(new Cpu6502Handler().describeInstruction("RTS"))).toEqual(["- IMPLIED 60 1"]);
		expect(forms(new Cpu6502Handler().describeInstruction("bne"))).toEqual(["label RELATIVE d0 2"]);
		expect(forms(new Cpu65C02Handler().describeInstruction("lda"))).toContain("($12) ZEROPAGE_INDIRECT b2 2");
		expect(new Cpu6502Handler().describeInstruction("stz")).toEqual([]);
	});

	it("gives the 65816's immediates as one or two bytes, by the register they load", () => {
		const cpu = new Cpu65816Handler();
		expect(forms(cpu.describeInstruction("lda"))).toContain("#$12 IMMEDIATE a9 2-3");
		expect(forms(cpu.describeInstruction("rep"))).toContain("#$12 IMMEDIATE c2 2");
	});

	it("gives the 6809's opcodes with their page, an indexed operand's extra bytes, a stack's register list", () => {
		const cpu = new Cpu6809Handler();
		expect(forms(cpu.describeInstruction("ldy"))).toEqual([
			"#$1234 IMMEDIATE 10 8e 4",
			"$12 DIRECT 10 9e 3",
			"$10,X INDEXED 10 ae 3-5",
			"$1234 EXTENDED 10 be 4",
		]);
		expect(forms(cpu.describeInstruction("cmps"))).toContain("#$1234 IMMEDIATE 11 8c 4");
		expect(forms(cpu.describeInstruction("lda"))).toContain("#$12 IMMEDIATE 86 2");
		expect(forms(cpu.describeInstruction("pshs"))).toEqual(["a, b, x INHERENT 34 2"]);
	});

	it("gives an RV32I instruction's format and fields", () => {
		const cpu = new CpuRV32IHandler();
		expect(forms(cpu.describeInstruction("add"))).toEqual(["rd, rs1, rs2 R-type opcode $33, funct3 0, funct7 0 4"]);
		expect(forms(cpu.describeInstruction("lw"))).toEqual(["rd, imm(rs1) I-type opcode 3, funct3 2 4"]);
		expect(forms(cpu.describeInstruction("sw"))).toEqual(["rs2, imm(rs1) S-type opcode $23, funct3 2 4"]);
		expect(forms(cpu.describeInstruction("jal"))).toEqual(["rd, label J-type opcode $6F 4"]);
	});

	it("is optional: the ARM stub has none", () => {
		const cpu: CPUHandler = new CpuArmRiscHandler();
		expect(cpu.describeInstruction).toBeUndefined();
	});
});
