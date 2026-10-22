import type { OperatorStackToken } from "../shared/lexer/lexer.class";

/** * Defines the standard addressing modes recognizable by the assembler.
 * Changed to 'string' to allow CPU Handlers to define their own specific modes
 * (e.g., 'M6502_ABSOLUTE', 'M6809_INDIRECT').
 */
export type AddressingMode = string;

/** Byte order of a CPU's multi-byte values. */
export type Endianness = "little" | "big";

/**
 * What resolveAddressingMode finds for an instruction, given back to encodeInstruction (with the PC).
 * A CPU can extend it with its own fields, like the 6809's post byte.
 */
export interface ModeInfo {
	mode: AddressingMode;
	opcode: number;
	bytes: number;
	/** The operand's value: null in pass 1 when it uses a symbol defined later. */
	resolvedAddress: number | null;
}

/** What encodeInstruction gets, in pass 2: the operand's value is known, and the PC is added. */
export type ResolvedModeInfo<TModeInfo extends ModeInfo = ModeInfo> = TModeInfo & { resolvedAddress: number; pc: number };

export interface CPUHandler<TModeInfo extends ModeInfo = ModeInfo> {
	cpuType: string;

	/** Byte order of the CPU: data directives (.dw, .dl, the .pstrl length) write their values in it too. */
	endianness: Endianness;

	/**
	 * Suffixes a mnemonic can take after a dot, given to resolveAddressingMode as part of the mnemonic: the 6502's
	 * `lda.b` / `lda.w` force a zero page / absolute operand. A CPU without suffixes leaves it out.
	 */
	mnemonicSuffixes?: readonly string[];

	/** * Core method to determine the specific addressing mode, opcode, and size
	 * based on the mnemonic and the structure of the operand tokens.
	 * @param resolveValue A function provided by the Assembler to evaluate expressions.
	 */
	resolveAddressingMode(
		mnemonic: string,
		operandTokens: OperatorStackToken[],
		resolveValue: (tokens: OperatorStackToken[], numberMax?: number) => number | null,
	): TModeInfo;

	/** Checks if a given mnemonic corresponds to a known instruction for this CPU. */
	isInstruction(mnemonic: string): boolean;

	/** Encodes the instruction into raw bytes, typically relying on modeInfo calculated in Pass 1. */
	encodeInstruction(tokens: OperatorStackToken[], modeInfo: ResolvedModeInfo<TModeInfo>): number[];
}
