import type { OperatorStackToken } from "../shared/lexer/lexer.class";
import type { AddressingMode, CPUHandler, ModeInfo, ResolvedModeInfo } from "./cpuhandler.interface";
export class CpuArmRiscHandler implements CPUHandler {
	cpuType = "ARM_RISC" as const;
	endianness = "little" as const;

	// ARM instructions are 32-bit (4 bytes) and fixed size in this implementation.
	private readonly INSTRUCTION_SIZE = 4;

	// Define ARM specific modes internally
	private ARM_MODES = {
		DATA_PROC: "ARM_DATA_PROC",
		BRANCH: "ARM_BRANCH",
	};

	// Simplified Instruction encoding base (Condition code 1110 = AL/Always)
	private instructionBases: Map<string, number> = new Map([
		// Format: [Opcode (High bits for instruction type and condition)]
		["MOV", 0xe3a00000], // Data Processing (MOV immediate)
		["B", 0xea000000], // Branch (B)
		// Add condition codes (EQ, NE, GT, etc.) later by changing bits 28-31
	]);

	private registerMap = new Map<string, number>([
		["R0", 0],
		["R1", 1],
		["R2", 2],
		["R3", 3],
		["R4", 4],
		["R5", 5],
		["R6", 6],
		["R7", 7],
		["R8", 8],
		["R9", 9],
		["R10", 10],
		["R11", 11],
		["R12", 12],
		["R13", 13],
		["R14", 14],
		["R15", 15],
		["SP", 13],
		["LR", 14],
		["PC", 15],
	]);

	isInstruction(mnemonic: string): boolean {
		const baseMnemonic = mnemonic.toUpperCase().match(/^[A-Z]+/)?.[0];
		if (!baseMnemonic) {
			return false;
		}
		// Check if the mnemonic is a known instruction.
		return this.instructionBases.has(baseMnemonic);
	}

	/** Helper to parse a register identifier R0-R15 */
	private getRegisterIndex(token: OperatorStackToken): number {
		const index = this.registerMap.get(token.value.toUpperCase());
		if (index === undefined) {
			throw new Error(`Invalid register: ${token.value}`);
		}
		return index;
	}

	/**
	 * Resolves addressing mode for ARM instructions.
	 * Simplification: only handles MOV Rdest, #Imm and B Label.
	 */
	resolveAddressingMode(mnemonic: string, operandTokens: OperatorStackToken[], resolveValue: (tokens: OperatorStackToken[]) => number | null): ModeInfo {
		const baseMnemonic = mnemonic.toUpperCase().match(/^[A-Z]+/)?.[0];
		if (!baseMnemonic) {
			// THROW here to signal a potential label to the Assembler engine
			throw new Error(`Unknown ARM instruction: ${mnemonic}`);
		}
		let opcode = this.instructionBases.get(baseMnemonic);
		if (!opcode) {
			// THROW here to signal a potential label to the Assembler engine
			throw new Error(`Unknown ARM instruction: ${mnemonic}`);
		}

		let resolvedAddress: number | null = 0;
		let mode: AddressingMode = "";

		// 1. Handle MOV Rdest, #Immediate (Data Processing)
		if (baseMnemonic === "MOV") {
			// ... (MOV logic remains the same) ...
			if (operandTokens.length >= 3 && operandTokens[1]?.value === ",") {
				const Rd = this.getRegisterIndex(operandTokens[0] as OperatorStackToken);

				if (operandTokens[2]?.value === "#") {
					// Immediate
					resolvedAddress = resolveValue(operandTokens.slice(3));
					mode = this.ARM_MODES.DATA_PROC;
					opcode = this.instructionBases.get("MOV") as number;
					opcode |= Rd << 12;
					// Unknown in pass 1 (defined later): the size is 4 bytes anyway, pass 2 adds the value.
					if (resolvedAddress !== null) opcode |= resolvedAddress & 0xff;
				} else {
					throw new Error("Only MOV Immediate is supported in this mock.");
				}
			} else {
				throw new Error("Invalid syntax for MOV instruction.");
			}
		}

		// 2. Handle B Label (Branch)
		else if (baseMnemonic === "B") {
			resolvedAddress = resolveValue(operandTokens);
			mode = this.ARM_MODES.BRANCH;
		}

		if (!mode) {
			throw new Error(`Could not resolve addressing mode for ${mnemonic}`);
		}

		return { mode, opcode, bytes: this.INSTRUCTION_SIZE, resolvedAddress };
	}

	/**
	 * Pass 2: Encodes the 4 bytes, in the CPU's byte order (little-endian, like data).
	 * @param modeInfo Contains the pre-calculated 32-bit opcode or target address.
	 */
	encodeInstruction(_tokens: OperatorStackToken[], modeInfo: ResolvedModeInfo): number[] {
		// We switch on the ARM specific mode strings
		// const mnemonic = tokens[0]?.value.toUpperCase();

		if (modeInfo.mode === this.ARM_MODES.BRANCH) {
			const targetAddress = modeInfo.resolvedAddress;
			const pc = modeInfo.pc;
			const offset = (targetAddress - (pc + 8)) >> 2;
			const opcode = (this.instructionBases.get("B") as number) | (offset & 0x00ffffff);

			// this.logger.log(`[PASS 2 - ARM] Encoded ${mnemonic} (Offset: ${offset})`);
			return this.u32ToBytes(opcode);
		}
		if (modeInfo.mode === this.ARM_MODES.DATA_PROC) {
			// console.log(`[PASS 2 - ARM] Encoded ${mnemonic}`);
			return this.u32ToBytes(modeInfo.opcode);
		}

		throw new Error(`Unhandled ARM encoding mode: ${modeInfo.mode}`);
	}

	/**
	 * Converts a 32-bit number (ARM instruction) into 4 bytes in the CPU's byte order. ARM is little-endian in
	 * practice, and since ARMv6 its instructions are stored little-endian even on a big-endian (BE-8) system.
	 */
	private u32ToBytes(value: number): number[] {
		const bytes = [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
		return this.endianness === "little" ? bytes : bytes.reverse();
	}
}
