import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { CpuRV32IHandler } from "../cpu/cpurv32i.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("RV32I Opcodes", () => {
	const assembleAndGetCode = (source: string): number[] => {
		const cpu = new CpuRV32IHandler();
		const assembler = new Assembler(cpu, new MockFileHandler(), {
			segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
			log: { pass1Enabled: true, pass2Enabled: true },
		});
		const segments = assembler.assemble(source);
		const codeSegment = segments.find((s) => s.name === "CODE");
		return codeSegment?.data ?? [];
	};

	it("should assemble ADDI instruction", () => {
		const source = "ADDI a0, zero, 42"; // x10, x0, 42
		const data = assembleAndGetCode(source);
		// imm=42, rs1=0, funct3=0, rd=10, opcode=0x13
		// 0x02A00513
		expect(data).toEqual([0x13, 0x05, 0xa0, 0x02]);
	});

	it("should assemble ADD instruction", () => {
		const source = "ADD a0, a1, a2"; // x10, x11, x12
		const data = assembleAndGetCode(source);
		// funct7=0, rs2=12, rs1=11, funct3=0, rd=10, opcode=0x33
		// 0x00C58533
		expect(data).toEqual([0x33, 0x85, 0xc5, 0x00]);
	});

	it("should assemble SUB instruction", () => {
		const source = "SUB a0, a1, a2"; // x10, x11, x12
		const data = assembleAndGetCode(source);
		// funct7=0x20, rs2=12, rs1=11, funct3=0, rd=10, opcode=0x33
		// 0x40C58533
		expect(data).toEqual([0x33, 0x85, 0xc5, 0x40]);
	});

	it("should assemble LW instruction", () => {
		const source = "LW a0, 12(sp)"; // lw a0, 12(x2)
		const data = assembleAndGetCode(source);
		// imm=12, rs1=2, funct3=2, rd=10, opcode=3
		// 0x00C12503
		expect(data).toEqual([0x03, 0x25, 0xc1, 0x00]);
	});

	it("should assemble SW instruction", () => {
		const source = "SW a0, 16(sp)"; // sw a0, 16(x2)
		const data = assembleAndGetCode(source);
		// imm=16, rs2=10, rs1=2, funct3=2, opcode=0x23
		// imm[11:5]=0, imm[4:0]=16
		// 0x00A12823
		expect(data).toEqual([0x23, 0x28, 0xa1, 0x00]);
	});

	it("should assemble BEQ instruction", () => {
		const source = "LOOP: BEQ zero, zero, LOOP";
		const data = assembleAndGetCode(source);
		// offset = 0 - 0 = 0
		// imm=0, rs2=0, rs1=0, funct3=0, opcode=0x63
		// 0x00000063
		// offset is -4 (current pc is 0, target is 0, so -4)
		// imm = -4 = 0xFFFFFFFC
		// imm[12] = 1, imm[10:5]=111111, imm[4:1]=1111, imm[11]=1
		// 0xFE000EE3
		expect(data).toEqual([0x63, 0x00, 0x00, 0x00]);
	});

	it("should assemble JAL instruction", () => {
		const source = "TARGET:\n JAL ra, TARGET";
		const data = assembleAndGetCode(source);
		// offset = 0 - 0 = 0; jal ra, 0
		// imm = 0, rd=1, opcode=0x6f
		// 0x000000EF
		expect(data).toEqual([0xef, 0x00, 0x00, 0x00]);
	});

	it("should assemble LUI instruction", () => {
		const source = "LUI a0, 0xDEAD0";
		const data = assembleAndGetCode(source);
		// imm=0xDEAD0, rd=10, opcode=0x37
		// 0xDEAD0537
		expect(data).toEqual([0x37, 0x05, 0xad, 0xde]);
	});

	it("should assemble AUIPC instruction", () => {
		const source = "AUIPC a0, 0";
		const data = assembleAndGetCode(source);
		// imm=0, rd=10, opcode=0x17
		// 0x00000517
		expect(data).toEqual([0x17, 0x05, 0x00, 0x00]);
	});
});
