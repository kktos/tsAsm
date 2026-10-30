import type { IDirective } from "../directives/directive.interface";
import type { OperatorStackToken } from "../shared/lexer/lexer.class";
import { AsmError, type DefinitionSite } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";
import type { InstructionContext, OperandReader } from "./cpuhandler.interface";
import { type ImmediateWidth, Mos65xxHandler, type Mos65xxModeInfo, type Mos65xxProfile } from "./mos65xx.class";
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

/** The accumulator (M) and the index registers (X): their bit in REP / SEP, and their names in messages. */
const REGISTERS = {
	A: { bit: 0x20, name: "the accumulator", width: "the accumulator's width", directives: ".a8 / .a16" },
	I: { bit: 0x10, name: "the index registers", width: "the index registers' width", directives: ".i8 / .i16" },
} as const;
type Register = keyof typeof REGISTERS;

/** The immediates whose width is the accumulator's (M), and the index registers' (X). */
const WIDTH_OF: Readonly<Record<string, Register>> = {
	LDA: "A",
	ADC: "A",
	SBC: "A",
	AND: "A",
	ORA: "A",
	EOR: "A",
	CMP: "A",
	BIT: "A",
	LDX: "I",
	LDY: "I",
	CPX: "I",
	CPY: "I",
};

/** What made the mode or a width unknown: an instruction, `XCE`, `PLP`, `RTI`, and where it is. */
interface Cause {
	what: string;
	site: DefinitionSite | undefined;
}

/** A width: 8 or 16 bits, or unknown since a `PLP`, an `RTI` or an `XCE`. */
type Width = 8 | 16 | Cause;

/** E: emulation (as after reset) or native, set by `XCE`; unknown after an `XCE` the assembler can't follow. */
type Mode = "emulation" | "native" | Cause;

/** A directive of the 65816's, taking no operand: the same in both passes. */
const directive = (run: () => void): IDirective => ({
	isBlockDirective: false,
	isRawDirective: false,
	handlePassOne: run,
	handlePassTwo: run,
});

/** "a PLP", "an RTI", "an XCE": an instruction's name is read letter by letter. */
const article = (what: string) => (/^[AEFHILMNORSX]/.test(what) ? `an ${what}` : `a ${what}`);

/** An error about something unknown since `cause`, with a note at it. */
function unknownError(message: string, cause: Cause, note: string): AsmError {
	const error = new AsmError(message);
	if (cause.site) error.notes.push({ message: note, ...cause.site });
	return error;
}

export class Cpu65816Handler extends Mos65xxHandler {
	private mode: Mode = "emulation";
	private widths: Record<Register, Width> = { A: 8, I: 8 };

	/**
	 * `.native` and `.emulation` say which mode the code after them runs in; `.a8`, `.a16`, `.i8` and `.i16` the width of
	 * the accumulator and of the index registers.
	 */
	readonly directives: Readonly<Record<string, IDirective>> = {
		NATIVE: directive(() => {
			this.mode = "native";
		}),
		EMULATION: directive(() => this.toEmulation()),
		A8: directive(() => this.setWidths(["A"], 8)),
		A16: directive(() => this.widen(".a16", ["A"])),
		I8: directive(() => this.setWidths(["I"], 8)),
		I16: directive(() => this.widen(".i16", ["I"])),
	};

	constructor() {
		super(P65816);
	}

	/** At the start of each pass, the 65816 is as after reset: in emulation mode, the widths 8 bits. */
	resetState() {
		this.toEmulation();
	}

	/** Emulation mode, where the accumulator and the index registers are 8 bits. */
	private toEmulation() {
		this.mode = "emulation";
		this.setWidths(["A", "I"], 8);
	}

	private setWidths(registers: readonly Register[], width: Width) {
		for (const register of registers) this.widths[register] = width;
	}

	/**
	 * Makes `registers` 16-bit, for `subject` (`REP #$30`, `.a16`): only in native mode. In emulation mode they stay 8
	 * bits, and while the mode is unknown, so is whether they can be 16.
	 */
	private widen(subject: string, registers: readonly Register[]) {
		const names = registers.map((register) => REGISTERS[register].name).join(" and ");
		if (this.mode === "emulation")
			throw new Error(
				`${subject} can't make ${names} 16-bit in emulation mode: switch to native mode with clc / xce, or say the code runs in it with .native.`,
			);
		if (this.mode !== "native")
			throw unknownError(
				`${subject} needs the 65816's mode, unknown since an XCE without clc or sec right before it: set it with clc / xce, sec / xce, .native or .emulation.`,
				this.mode,
				"the mode is unknown after this XCE",
			);
		this.setWidths(registers, 16);
	}

	/**
	 * `XCE` swaps the carry and E: only the idiom is followed, `clc` right before it gives native mode, `sec` emulation.
	 * Anything else before it, or anything between them (`InstructionContext.previous`), makes the mode unknown, and a
	 * width that isn't 8 with it: emulation mode would make it 8, native mode keep it.
	 */
	private exchange(context: InstructionContext | undefined) {
		const previous = context?.previous;
		if (previous === "CLC") this.mode = "native";
		else if (previous === "SEC") this.toEmulation();
		else {
			const cause = { what: "XCE", site: context?.site() };
			this.mode = cause;
			for (const register of ["A", "I"] as const) if (this.widths[register] !== 8) this.widths[register] = cause;
		}
	}

	/** `PLP` and `RTI` pull the flags: in native mode, or one that may be, the widths are then unknown. */
	private pullFlags(what: string, context: InstructionContext | undefined) {
		if (this.mode !== "emulation") this.setWidths(["A", "I"], { what, site: context?.site() });
	}

	/** The registers whose bit is set in REP's or SEP's operand: a number, known here, as the widths after it depend on it. */
	private flagRegisters(what: string, info: Mos65xxModeInfo): { value: number; registers: Register[] } {
		if (info.fixup) throw new Error(`${what} #${info.fixup.value}: ${what} needs a number, known before the program is loaded.`);
		const value = info.resolvedAddress;
		if (value === null)
			throw new Error(`${what}'s operand must be known here: define its symbols before the ${what}, as the widths after it depend on it.`);
		return { value, registers: (["A", "I"] as const).filter((register) => value & REGISTERS[register].bit) };
	}

	/** The width of `mnemonic`'s immediate, if it has M's or X's: the one `.b` / `.w` forces, else the register's. */
	protected override immediateWidth(mnemonic: string, forcedWidth: 1 | 2 | null): ImmediateWidth | undefined {
		const register = WIDTH_OF[mnemonic];
		if (!register) return undefined;
		const width = forcedWidth ? forcedWidth * 8 : this.widths[register];
		if (typeof width !== "number") {
			const { width: name, directives } = REGISTERS[register];
			throw unknownError(
				`${mnemonic}'s immediate needs ${name}, unknown since ${article(width.what)}: set it with ${directives}, or sep / rep.`,
				width,
				`${name} is unknown after this ${width.what}`,
			);
		}
		return { bytes: width === 16 ? 2 : 1, listing: `${register}${width}` };
	}

	override resolveAddressingMode(
		mnemonic: string,
		operandTokens: OperatorStackToken[],
		resolveValue: (tokens: OperatorStackToken[]) => number | null,
		operands: OperandReader,
		context?: InstructionContext,
	): Mos65xxModeInfo {
		const info = super.resolveAddressingMode(mnemonic, operandTokens, resolveValue, operands);
		const base = mnemonic.toUpperCase().split(".")[0] as string;
		switch (base) {
			case "XCE":
				this.exchange(context);
				break;
			case "PLP":
			case "RTI":
				this.pullFlags(base, context);
				break;
			case "REP": {
				const { value, registers } = this.flagRegisters(base, info);
				if (registers.length) this.widen(`REP #$${getHex(value)}`, registers);
				break;
			}
			case "SEP":
				this.setWidths(this.flagRegisters(base, info).registers, 8);
				break;
		}
		return info;
	}
}
