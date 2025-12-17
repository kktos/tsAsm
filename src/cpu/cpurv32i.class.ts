import type { OperatorStackToken } from "../shared/lexer/lexer.class";
import type { AddressingMode, CPUHandler } from "./cpuhandler.interface";

// In RISC-V, there aren't addressing modes in the traditional sense, but instruction formats.
// We'll use the instruction format names as "addressing modes".
const RV32I_FORMATS = {
	R: "R-type",
	I: "I-type",
	S: "S-type",
	B: "B-type",
	U: "U-type",
	J: "J-type",
};

export class CpuRV32IHandler implements CPUHandler {
	cpuType = "RV32I" as const;

	private registerMap: Map<string, number> = new Map([
		["zero", 0],
		["x0", 0],
		["ra", 1],
		["x1", 1],
		["sp", 2],
		["x2", 2],
		["gp", 3],
		["x3", 3],
		["tp", 4],
		["x4", 4],
		["t0", 5],
		["x5", 5],
		["t1", 6],
		["x6", 6],
		["t2", 7],
		["x7", 7],
		["s0", 8],
		["fp", 8],
		["x8", 8],
		["s1", 9],
		["x9", 9],
		["a0", 10],
		["x10", 10],
		["a1", 11],
		["x11", 11],
		["a2", 12],
		["x12", 12],
		["a3", 13],
		["x13", 13],
		["a4", 14],
		["x14", 14],
		["a5", 15],
		["x15", 15],
		["a6", 16],
		["x16", 16],
		["a7", 17],
		["x17", 17],
		["s2", 18],
		["x18", 18],
		["s3", 19],
		["x19", 19],
		["s4", 20],
		["x20", 20],
		["s5", 21],
		["x21", 21],
		["s6", 22],
		["x22", 22],
		["s7", 23],
		["x23", 23],
		["s8", 24],
		["x24", 24],
		["s9", 25],
		["x25", 25],
		["s10", 26],
		["x26", 26],
		["s11", 27],
		["x27", 27],
		["t3", 28],
		["x28", 28],
		["t4", 29],
		["x29", 29],
		["t5", 30],
		["x30", 30],
		["t6", 31],
		["x31", 31],
	]);

	// Instruction map: mnemonic -> format -> {opcode, funct3, funct7}
	private instructionMap: Map<string, Map<AddressingMode, { opcode: number; funct3?: number; funct7?: number }>> = new Map([
		// I-type
		["ADDI", new Map([[RV32I_FORMATS.I, { opcode: 0x13, funct3: 0x0 }]])],
		["SLTI", new Map([[RV32I_FORMATS.I, { opcode: 0x13, funct3: 0x2 }]])],
		["SLTIU", new Map([[RV32I_FORMATS.I, { opcode: 0x13, funct3: 0x3 }]])],
		["XORI", new Map([[RV32I_FORMATS.I, { opcode: 0x13, funct3: 0x4 }]])],
		["ORI", new Map([[RV32I_FORMATS.I, { opcode: 0x13, funct3: 0x6 }]])],
		["ANDI", new Map([[RV32I_FORMATS.I, { opcode: 0x13, funct3: 0x7 }]])],
		["SLLI", new Map([[RV32I_FORMATS.I, { opcode: 0x13, funct3: 0x1, funct7: 0x00 }]])],
		["SRLI", new Map([[RV32I_FORMATS.I, { opcode: 0x13, funct3: 0x5, funct7: 0x00 }]])],
		["SRAI", new Map([[RV32I_FORMATS.I, { opcode: 0x13, funct3: 0x5, funct7: 0x20 }]])],

		["LB", new Map([[RV32I_FORMATS.I, { opcode: 0x03, funct3: 0x0 }]])],
		["LH", new Map([[RV32I_FORMATS.I, { opcode: 0x03, funct3: 0x1 }]])],
		["LW", new Map([[RV32I_FORMATS.I, { opcode: 0x03, funct3: 0x2 }]])],
		["LBU", new Map([[RV32I_FORMATS.I, { opcode: 0x03, funct3: 0x4 }]])],
		["LHU", new Map([[RV32I_FORMATS.I, { opcode: 0x03, funct3: 0x5 }]])],
		["JALR", new Map([[RV32I_FORMATS.I, { opcode: 0x67, funct3: 0x0 }]])],

		// S-type
		["SB", new Map([[RV32I_FORMATS.S, { opcode: 0x23, funct3: 0x0 }]])],
		["SH", new Map([[RV32I_FORMATS.S, { opcode: 0x23, funct3: 0x1 }]])],
		["SW", new Map([[RV32I_FORMATS.S, { opcode: 0x23, funct3: 0x2 }]])],

		// R-type
		["ADD", new Map([[RV32I_FORMATS.R, { opcode: 0x33, funct3: 0x0, funct7: 0x00 }]])],
		["SUB", new Map([[RV32I_FORMATS.R, { opcode: 0x33, funct3: 0x0, funct7: 0x20 }]])],
		["SLL", new Map([[RV32I_FORMATS.R, { opcode: 0x33, funct3: 0x1, funct7: 0x00 }]])],
		["SLT", new Map([[RV32I_FORMATS.R, { opcode: 0x33, funct3: 0x2, funct7: 0x00 }]])],
		["SLTU", new Map([[RV32I_FORMATS.R, { opcode: 0x33, funct3: 0x3, funct7: 0x00 }]])],
		["XOR", new Map([[RV32I_FORMATS.R, { opcode: 0x33, funct3: 0x4, funct7: 0x00 }]])],
		["SRL", new Map([[RV32I_FORMATS.R, { opcode: 0x33, funct3: 0x5, funct7: 0x00 }]])],
		["SRA", new Map([[RV32I_FORMATS.R, { opcode: 0x33, funct3: 0x5, funct7: 0x20 }]])],
		["OR", new Map([[RV32I_FORMATS.R, { opcode: 0x33, funct3: 0x6, funct7: 0x00 }]])],
		["AND", new Map([[RV32I_FORMATS.R, { opcode: 0x33, funct3: 0x7, funct7: 0x00 }]])],

		// B-type
		["BEQ", new Map([[RV32I_FORMATS.B, { opcode: 0x63, funct3: 0x0 }]])],
		["BNE", new Map([[RV32I_FORMATS.B, { opcode: 0x63, funct3: 0x1 }]])],
		["BLT", new Map([[RV32I_FORMATS.B, { opcode: 0x63, funct3: 0x4 }]])],
		["BGE", new Map([[RV32I_FORMATS.B, { opcode: 0x63, funct3: 0x5 }]])],
		["BLTU", new Map([[RV32I_FORMATS.B, { opcode: 0x63, funct3: 0x6 }]])],
		["BGEU", new Map([[RV32I_FORMATS.B, { opcode: 0x63, funct3: 0x7 }]])],

		// U-type
		["LUI", new Map([[RV32I_FORMATS.U, { opcode: 0x37 }]])],
		["AUIPC", new Map([[RV32I_FORMATS.U, { opcode: 0x17 }]])],

		// J-type
		["JAL", new Map([[RV32I_FORMATS.J, { opcode: 0x6f }]])],
	]);

	getPCSize(): number {
		return 32;
	}
	handleCPUSpecificDirective(_directive: string, _args: unknown[]): void {
		// No specific directives for now
	}

	isInstruction(mnemonic: string): boolean {
		return this.instructionMap.has(mnemonic.toUpperCase());
	}

	resolveAddressingMode(
		mnemonic: string,
		operandTokens: OperatorStackToken[],
		resolveValue: (tokens: OperatorStackToken[]) => number,
	): {
		mode: AddressingMode;
		opcode: number;
		bytes: number;
		resolvedAddress: number;
		funct3?: number;
		funct7?: number;
		rd?: number;
		rs1?: number;
		rs2?: number;
		imm?: number;
	} {
		const upperMnemonic = mnemonic.toUpperCase();
		const instructionGroup = this.instructionMap.get(upperMnemonic);
		if (!instructionGroup) throw new Error(`Unknown instruction mnemonic: ${mnemonic}`);

		// RISC-V has a fixed instruction size of 4 bytes
		const bytes = 4;

		// The "mode" is the first (and only) key in the instruction's map
		const mode = instructionGroup.keys().next().value as AddressingMode;
		const { opcode, funct3, funct7 } = instructionGroup.get(mode) as {
			opcode: number;
			funct3?: number;
			funct7?: number;
		};

		const operands = this.parseOperands(operandTokens);

		let rd: number | undefined;
		let rs1: number | undefined;
		let rs2: number | undefined;
		let imm: number | undefined;

		switch (mode) {
			case RV32I_FORMATS.R: // ADD rd, rs1, rs2
				rd = this.parseRegister(operands[0]);
				rs1 = this.parseRegister(operands[1]);
				rs2 = this.parseRegister(operands[2]);
				break;
			case RV32I_FORMATS.I: // ADDI rd, rs1, imm
				rd = this.parseRegister(operands[0]);
				if (upperMnemonic.startsWith("L")) {
					// LW rd, imm(rs1)
					const parts = this.parseLoadStoreOperands(operands[1]);
					rs1 = this.parseRegister(parts.rs1);
					imm = resolveValue(parts.imm);
				} else {
					// ADDI rd, rs1, imm
					rs1 = this.parseRegister(operands[1]);
					if (!operands[2]) throw new Error("Invalid I-type instruction");
					imm = resolveValue(operands[2]);
				}
				break;
			case RV32I_FORMATS.S: {
				// SW rs2, imm(rs1)
				rs2 = this.parseRegister(operands[0]);
				const parts = this.parseLoadStoreOperands(operands[1]);
				rs1 = this.parseRegister(parts.rs1);
				imm = resolveValue(parts.imm);
				break;
			}
			case RV32I_FORMATS.B: // BEQ rs1, rs2, imm
				rs1 = this.parseRegister(operands[0]);
				rs2 = this.parseRegister(operands[1]);
				if (!operands[2]) throw new Error("Invalid B-type instruction");
				imm = resolveValue(operands[2]); // This will be a PC-relative offset
				break;
			case RV32I_FORMATS.U: // LUI rd, imm
				rd = this.parseRegister(operands[0]);
				if (!operands[1]) throw new Error("Invalid U-type instruction");
				imm = resolveValue(operands[1]);
				break;
			case RV32I_FORMATS.J: // JAL rd, imm
				rd = this.parseRegister(operands[0]);
				if (!operands[1]) throw new Error("Invalid J-type instruction");
				imm = resolveValue(operands[1]); // This will be a PC-relative offset
				break;
			default:
				throw new Error(`Unsupported format ${mode as string} for instruction ${mnemonic}`);
		}

		return {
			mode,
			opcode,
			bytes,
			resolvedAddress: 0, // Not used in the same way as 6502
			funct3,
			funct7,
			rd,
			rs1,
			rs2,
			imm,
		};
	}

	encodeInstruction(
		_tokens: OperatorStackToken[],
		modeInfo: {
			mode: AddressingMode;
			opcode: number;
			bytes: number;
			pc: number;
			funct3?: number;
			funct7?: number;
			rd?: number;
			rs1?: number;
			rs2?: number;
			imm?: number;
		},
	): number[] {
		let instruction = 0;
		const { opcode, funct3, funct7, rd, rs1, rs2, imm, pc, mode } = modeInfo;

		let finalImm = imm ?? 0;

		// Handle PC-relative immediates for B and J types
		if (imm !== undefined && (mode === RV32I_FORMATS.B || mode === RV32I_FORMATS.J)) {
			finalImm = imm - pc;
		}

		instruction |= opcode;

		switch (modeInfo.mode) {
			case RV32I_FORMATS.R:
				if (rd === undefined || rs1 === undefined || rs2 === undefined || funct3 === undefined || funct7 === undefined)
					throw new Error("Invalid R-type instruction fields");
				instruction |= (rd & 0x1f) << 7;
				instruction |= (funct3 & 0x7) << 12;
				instruction |= (rs1 & 0x1f) << 15;
				instruction |= (rs2 & 0x1f) << 20;
				instruction |= (funct7 & 0x7f) << 25;
				break;

			case RV32I_FORMATS.I:
				if (rd === undefined || rs1 === undefined || funct3 === undefined) throw new Error("Invalid I-type instruction fields");
				instruction |= (rd & 0x1f) << 7;
				instruction |= (funct3 & 0x7) << 12;
				instruction |= (rs1 & 0x1f) << 15;
				instruction |= (finalImm & 0xfff) << 20;
				break;

			case RV32I_FORMATS.S: {
				if (rs1 === undefined || rs2 === undefined || funct3 === undefined) throw new Error("Invalid S-type instruction fields");
				const immS_4_0 = finalImm & 0x1f;
				const immS_11_5 = (finalImm >> 5) & 0x7f;
				instruction |= (immS_4_0 & 0x1f) << 7;
				instruction |= (funct3 & 0x7) << 12;
				instruction |= (rs1 & 0x1f) << 15;
				instruction |= (rs2 & 0x1f) << 20;
				instruction |= (immS_11_5 & 0x7f) << 25;
				break;
			}

			case RV32I_FORMATS.B: {
				if (rs1 === undefined || rs2 === undefined || funct3 === undefined) throw new Error("Invalid B-type instruction fields");
				const immB_11 = (finalImm >> 11) & 0x1;
				const immB_4_1 = (finalImm >> 1) & 0xf;
				const immB_10_5 = (finalImm >> 5) & 0x3f;
				const immB_12 = (finalImm >> 12) & 0x1;
				instruction |= (immB_11 & 1) << 7;
				instruction |= (immB_4_1 & 0xf) << 8;
				instruction |= (funct3 & 0x7) << 12;
				instruction |= (rs1 & 0x1f) << 15;
				instruction |= (rs2 & 0x1f) << 20;
				instruction |= (immB_10_5 & 0x3f) << 25;
				instruction |= (immB_12 & 1) << 31;
				break;
			}

			case RV32I_FORMATS.U:
				if (rd === undefined) throw new Error("Invalid U-type instruction fields");
				instruction |= (rd & 0x1f) << 7;
				instruction |= finalImm << 12; // U-immediate is bits 31-12
				break;

			case RV32I_FORMATS.J: {
				if (rd === undefined) throw new Error("Invalid J-type instruction fields");
				const immJ_20 = (finalImm >> 20) & 0x1;
				const immJ_10_1 = (finalImm >> 1) & 0x3ff;
				const immJ_11 = (finalImm >> 11) & 0x1;
				const immJ_19_12 = (finalImm >> 12) & 0xff;
				instruction |= (rd & 0x1f) << 7;
				instruction |= (immJ_19_12 & 0xff) << 12;
				instruction |= (immJ_11 & 1) << 20;
				instruction |= (immJ_10_1 & 0x3ff) << 21;
				instruction |= (immJ_20 & 1) << 31;
				break;
			}
			default:
				throw new Error(`Unsupported format ${modeInfo.mode as string} for encoding`);
		}

		// Return as a little-endian byte array
		return [(instruction >> 0) & 0xff, (instruction >> 8) & 0xff, (instruction >> 16) & 0xff, (instruction >> 24) & 0xff];
	}

	private parseRegister(tokens: OperatorStackToken[] | undefined): number {
		if (!tokens) throw new Error("Unknown register");
		if (tokens.length !== 1 || tokens[0]?.type !== "IDENTIFIER") throw new Error(`Invalid register format: ${tokens.map((t) => t.value).join("")}`);

		const regName = tokens[0].value.toLowerCase();
		const regNum = this.registerMap.get(regName);
		if (regNum === undefined) {
			throw new Error(`Unknown register: ${regName}`);
		}
		return regNum;
	}

	private parseLoadStoreOperands(tokens: OperatorStackToken[] | undefined): {
		imm: OperatorStackToken[];
		rs1: OperatorStackToken[];
	} {
		if (!tokens) throw new Error("Invalid memory format");

		const openParen = tokens.findIndex((t) => t.value === "(");
		const closeParen = tokens.findIndex((t) => t.value === ")");
		if (openParen === -1 || closeParen === -1 || closeParen < openParen) throw new Error(`Invalid memory format: ${tokens.map((t) => t.value).join("")}`);

		const imm = tokens.slice(0, openParen);
		const rs1 = tokens.slice(openParen + 1, closeParen);
		return { imm, rs1 };
	}

	private parseOperands(tokens: OperatorStackToken[]): OperatorStackToken[][] {
		const operands: OperatorStackToken[][] = [];
		let currentOperand: OperatorStackToken[] = [];
		for (const token of tokens) {
			if (token.value === ",") {
				operands.push(currentOperand);
				currentOperand = [];
			} else {
				currentOperand.push(token);
			}
		}
		operands.push(currentOperand);
		return operands;
	}
}
