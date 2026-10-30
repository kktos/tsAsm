import type { IDirective } from "../directives/directive.interface";
import type { OperatorStackToken } from "../shared/lexer/lexer.class";
import { AsmError, type DefinitionSite } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";
import type { InstructionContext, OperandReader } from "./cpuhandler.interface";
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

/** E: emulation (as after reset) or native, set by `XCE`; unknown after an `XCE` the assembler can't follow. */
type Mode = "emulation" | "native" | "unknown";

/** A directive of the 65816's, taking no operand: the same in both passes. */
const directive = (run: () => void): IDirective => ({
	isBlockDirective: false,
	isRawDirective: false,
	handlePassOne: run,
	handlePassTwo: run,
});

export class Cpu65816Handler extends Mos65xxHandler {
	private mode: Mode = "emulation";
	/** The `XCE` that made the mode unknown: the note of an error needing the mode. */
	private unknownSince: DefinitionSite | undefined;

	/** `.native` and `.emulation` say which mode the code after them runs in. */
	readonly directives: Readonly<Record<string, IDirective>> = {
		NATIVE: directive(() => this.setMode("native")),
		EMULATION: directive(() => this.setMode("emulation")),
	};

	constructor() {
		super(P65816);
	}

	/** At the start of each pass, the 65816 is as after reset: in emulation mode. */
	resetState() {
		this.setMode("emulation");
	}

	private setMode(mode: Mode, since?: DefinitionSite) {
		this.mode = mode;
		this.unknownSince = since;
	}

	/**
	 * `XCE` swaps the carry and E: only the idiom is followed, `clc` right before it gives native mode, `sec` emulation.
	 * Anything else before it, or anything between them (`InstructionContext.previous`), makes the mode unknown.
	 */
	private exchange(context: InstructionContext | undefined) {
		const previous = context?.previous;
		if (previous === "CLC") this.setMode("native");
		else if (previous === "SEC") this.setMode("emulation");
		else this.setMode("unknown", context?.site());
	}

	/**
	 * A REP making the accumulator or the index registers 16-bit: never in emulation mode, where they stay 8 bits, nor
	 * while the mode is unknown. In native mode, until the widths are tracked (TODO 4.16), they stay 8 bits too: the
	 * immediates after it would be assembled on one byte where the CPU reads two.
	 */
	private checkRep(info: Mos65xxModeInfo) {
		if (info.fixup) throw new Error(`REP #${info.fixup.value}: REP needs a number, known before the program is loaded.`);
		const value = info.resolvedAddress;
		if (value === null) return;
		const flags = WIDTH_FLAGS.filter(([bit]) => value & bit).map(([, name]) => name);
		if (!flags.length) return;
		const rep = `REP #$${getHex(value)}`;
		const widths = flags.join(" and ");
		if (this.mode === "emulation")
			throw new Error(
				`${rep} can't make ${widths} 16-bit in emulation mode: switch to native mode with clc / xce, or say the code runs in it with .native.`,
			);
		if (this.mode === "unknown") {
			const error = new AsmError(
				`${rep} needs the 65816's mode, unknown since an XCE without clc or sec right before it: set it with clc / xce, sec / xce, .native or .emulation.`,
			);
			if (this.unknownSince) error.notes.push({ message: "the mode is unknown after this XCE", ...this.unknownSince });
			throw error;
		}
		throw new Error(`${rep} makes ${widths} 16-bit: the 65816's widths stay 8 bits for now.`);
	}

	override resolveAddressingMode(
		mnemonic: string,
		operandTokens: OperatorStackToken[],
		resolveValue: (tokens: OperatorStackToken[]) => number | null,
		operands: OperandReader,
		context?: InstructionContext,
	): Mos65xxModeInfo {
		const info = super.resolveAddressingMode(mnemonic, operandTokens, resolveValue, operands);
		const base = mnemonic.toUpperCase().split(".")[0];
		if (base === "XCE") this.exchange(context);
		if (base === "REP") this.checkRep(info);
		return info;
	}
}
