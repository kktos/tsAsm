import type { OperatorStackToken } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import type { OperandReader } from "./cpuhandler.interface";
import { Mos65xxHandler, type Mos65xxModeInfo, type Mos65xxProfile } from "./mos65xx.class";
import { CMOS_ADDITIONS, NMOS, W65816_ADDITIONS, WDC_ADDITIONS } from "./mos65xx.opcodes";

// The 65816's BRK takes a signature byte (W65816_ADDITIONS): NMOS's one-byte BRK is left out.
const { BRK: _brk, ...NMOS_WITHOUT_BRK } = NMOS;

/** The WDC W65C816S: the WDC 65C02 without Rockwell's bit instructions, whose opcodes it uses for its own. */
export const P65816: Mos65xxProfile = {
	cpuType: "65816",
	aliases: ["65C816"],
	addressBits: 24,
	bankBits: 16,
	opcodeSets: [NMOS_WITHOUT_BRK, CMOS_ADDITIONS, WDC_ADDITIONS, W65816_ADDITIONS],
	suffixes: { B: 1, W: 2 },
};

/** REP's bits for the accumulator (M) and the index registers (X): clearing one makes it 16-bit. */
const WIDTH_FLAGS = [
	[0x20, "the accumulator"],
	[0x10, "the index registers"],
] as const;

export class Cpu65816Handler extends Mos65xxHandler {
	constructor() {
		super(P65816);
	}

	/**
	 * Until the widths are tracked (TODO 4.16), they stay 8 bits: a REP making one 16-bit is an error, as the immediates
	 * after it would be assembled on one byte where the CPU reads two.
	 */
	override resolveAddressingMode(
		mnemonic: string,
		operandTokens: OperatorStackToken[],
		resolveValue: (tokens: OperatorStackToken[]) => number | null,
		operands: OperandReader,
	): Mos65xxModeInfo {
		const info = super.resolveAddressingMode(mnemonic, operandTokens, resolveValue, operands);
		if (info.opcode !== W65816_ADDITIONS.REP?.IMMEDIATE) return info;
		if (info.fixup) throw new Error(`REP #${info.fixup.value}: REP needs a number, known before the program is loaded.`);
		const value = info.resolvedAddress;
		if (value === null) return info;
		const flags = WIDTH_FLAGS.filter(([bit]) => value & bit).map(([, name]) => name);
		if (flags.length) throw new Error(`REP #$${getHex(value)} makes ${flags.join(" and ")} 16-bit: the 65816's widths stay 8 bits for now.`);
		return info;
	}
}
