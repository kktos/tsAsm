import type { RelocValue } from "../assembler/reloc-value.class";
import type { IDirective } from "../directives/directive.interface";
import type { OperatorStackToken } from "../shared/lexer/lexer.class";
import type { DefinitionSite } from "../utils/error.utils";

/** * Defines the standard addressing modes recognizable by the assembler.
 * Changed to 'string' to allow CPU Handlers to define their own specific modes
 * (e.g., the 65xx's 'ZEROPAGE_X', the 6809's 'M6809_INDIRECT').
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
	/** A relocatable operand, written in `size` bytes at `at` of the instruction: the fixup the assembler records. */
	fixup?: { at: number; size: number; value: RelocValue };
}

/**
 * How a CPU that records fixups reads its operands, in place of `resolveValue`: a relocatable value is given as is, for
 * the CPU to place and to say where its bytes go (`ModeInfo.fixup`). Null in pass 1 for a symbol defined later.
 */
export interface OperandReader {
	/** An address or a value, relocatable too. */
	value(tokens: OperatorStackToken[]): number | RelocValue | null;
	/**
	 * A branch target: an address in the instruction's segment, whose distance from it is known. In a relocatable
	 * segment, its offset there; a fixed address, or one in another segment, is an error.
	 */
	branchTarget(tokens: OperatorStackToken[]): number | null;
}

/** What the assembler tells a CPU about an instruction besides its operands: what came before it, and where it is. */
export interface InstructionContext {
	/**
	 * The upper-case mnemonic, without its suffix, of the instruction right before this one with nothing between them:
	 * no label, no byte written, no PC moved, no segment switched. Undefined otherwise: the CPU could reach this
	 * instruction another way, or run something else first.
	 */
	previous: string | undefined;
	/** Where this instruction is: for a note pointing back to it in a later error. */
	site(): DefinitionSite;
}

/** What encodeInstruction gets, in pass 2: the operand's value is known, and the PC is added. */
export type ResolvedModeInfo<TModeInfo extends ModeInfo = ModeInfo> = TModeInfo & {
	resolvedAddress: number;
	pc: number;
};

export interface CPUHandler<TModeInfo extends ModeInfo = ModeInfo> {
	cpuType: string;

	/** Other names `.cpu` and the `cpu` option take for it, in any case: the 65816's `65C816`. */
	aliases?: readonly string[];

	/** Byte order of the CPU: data directives (.dw, .dl, the .pstrl length) write their values in it too. */
	endianness: Endianness;

	/** Width of the address bus: the PC's range is 0 to 2 ** addressBits - 1. Leaving it is an error. */
	addressBits: number;

	/**
	 * Width of the PC in its bank, on a CPU whose PC doesn't carry into the next bank: 16 on the 65816. An instruction
	 * whose bytes cross a bank is an error; data can. Left out, there are no banks.
	 */
	bankBits?: number;

	/**
	 * Suffixes a mnemonic can take after a dot, given to resolveAddressingMode as part of the mnemonic: the 6502's
	 * `lda.b` / `lda.w` force a zero page / absolute operand. A CPU without suffixes leaves it out.
	 */
	mnemonicSuffixes?: readonly string[];

	/**
	 * The CPU's own directives, by upper-case name: the 65816's `.native`. They are known whatever the CPU, and run only
	 * while this one is the current CPU. A name can't be a general directive's. They take no operand: anything after
	 * one on its line is an error.
	 */
	directives?: Readonly<Record<string, IDirective>>;

	/**
	 * For a CPU keeping state (the 65816's M / X): puts it back as after reset. Called at the start of each pass, for
	 * every CPU given to the assembler; the state is kept across `.cpu` switches.
	 */
	resetState?(): void;

	/** * Core method to determine the specific addressing mode, opcode, and size
	 * based on the mnemonic and the structure of the operand tokens.
	 * @param resolveValue A function provided by the Assembler to evaluate expressions: a relocatable value is an error.
	 * @param operands For a CPU that records fixups, in place of `resolveValue`: see `OperandReader`.
	 * @param context What came before the instruction, and where it is: see `InstructionContext`. Called once per pass for
	 * each instruction, in order: a CPU keeping state (the 65816's E) changes it here.
	 */
	resolveAddressingMode(
		mnemonic: string,
		operandTokens: OperatorStackToken[],
		resolveValue: (tokens: OperatorStackToken[]) => number | null,
		operands: OperandReader,
		context?: InstructionContext,
	): TModeInfo;

	/** Checks if a given mnemonic corresponds to a known instruction for this CPU. */
	isInstruction(mnemonic: string): boolean;

	/** Encodes the instruction into raw bytes, typically relying on modeInfo calculated in Pass 1. */
	encodeInstruction(tokens: OperatorStackToken[], modeInfo: ResolvedModeInfo<TModeInfo>): number[];
}
