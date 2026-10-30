import { RelocValue } from "../assembler/reloc-value.class";
import type { OperatorStackToken } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import { assertFitsInBytes } from "../utils/number.utils";
import { findClosingBracket, findTopLevelComma } from "../utils/token.utils";
import type { CPUHandler, InstructionContext, ModeInfo, OperandReader, ResolvedModeInfo } from "./cpuhandler.interface";
import type { Mos65xxMode, OpcodeSet } from "./mos65xx.opcodes";

/** What makes one 65xx CPU: its name, the opcode sets it's made of, and its mnemonic suffixes. */
export interface Mos65xxProfile {
	cpuType: string;
	/** Other names `.cpu` takes for it: see `CPUHandler.aliases`. */
	aliases?: readonly string[];
	/** Width of the address bus: 16, 24 for the 65816. */
	addressBits: number;
	/** Width of the PC in its bank, 16 for the 65816: see `CPUHandler.bankBits`. */
	bankBits?: number;
	/** Merged per mnemonic when the handler is built: a mnemonic and mode given by two sets is an error. */
	opcodeSets: readonly OpcodeSet[];
	/** The address width, in bytes, each suffix forces: `lda.b` zero page, `lda.w` absolute, the 65816's `lda.l` long. */
	suffixes: Readonly<Record<string, AddressWidth>>;
}

/** An address's width in bytes: zero page, absolute, long. */
type AddressWidth = 1 | 2 | 3;

/**
 * BBR / BBS have two operands: the branch target is in resolvedAddress, the zero page address here. MVN / MVP too:
 * the destination bank in resolvedAddress, the source bank here.
 */
export interface Mos65xxModeInfo extends ModeInfo {
	zeroPage?: number | null;
	sourceBank?: number | null;
	/** JMP's or JSR's absolute target, all of it in resolvedAddress: it must be in the instruction's bank, checked when encoded. */
	programBank?: boolean;
}

/** An immediate's size, and what the listing writes after it: see `Mos65xxHandler.immediateWidth`. */
export interface ImmediateWidth {
	bytes: 1 | 2;
	listing?: string;
}

/** An instruction's size follows from its mode. */
const MODE_BYTES: Record<Mos65xxMode, number> = {
	IMPLIED: 1,
	ACCUMULATOR: 1,
	IMMEDIATE: 2,
	RELATIVE: 2,
	ZEROPAGE_RELATIVE: 3,
	ZEROPAGE: 2,
	ZEROPAGE_X: 2,
	ZEROPAGE_Y: 2,
	INDIRECT_X: 2,
	INDIRECT_Y: 2,
	ZEROPAGE_INDIRECT: 2,
	ABSOLUTE: 3,
	ABSOLUTE_X: 3,
	ABSOLUTE_Y: 3,
	INDIRECT: 3,
	ABSOLUTE_INDIRECT_X: 3,
	ZEROPAGE_INDIRECT_LONG: 2,
	ZEROPAGE_INDIRECT_LONG_Y: 2,
	ABSOLUTE_INDIRECT_LONG: 3,
	ABSOLUTE_LONG: 4,
	ABSOLUTE_LONG_X: 4,
	STACK_RELATIVE: 2,
	STACK_RELATIVE_INDIRECT_Y: 2,
	RELATIVE_LONG: 3,
	BLOCK_MOVE: 3,
	SIGNATURE: 2,
};

/** The largest address of each width: zero page, absolute, long. */
type AddressMax = 0xff | 0xffff | 0xffffff;

/** The zero page, absolute and long modes of a direct or indexed operand, by width: there's no long `,Y`. */
const ADDRESS_MODES = {
	"": ["ZEROPAGE", "ABSOLUTE", "ABSOLUTE_LONG"],
	",X": ["ZEROPAGE_X", "ABSOLUTE_X", "ABSOLUTE_LONG_X"],
	",Y": ["ZEROPAGE_Y", "ABSOLUTE_Y", undefined],
} as const satisfies Record<string, readonly [Mos65xxMode, Mos65xxMode, Mos65xxMode | undefined]>;

const WIDTH_NAMES: Record<AddressWidth, string> = { 1: "zero page", 2: "absolute", 3: "long" };

/** JMP and JSR, whose absolute target is in the program bank, and the 65816's instruction reaching another one. */
const LONG_JUMPS: Readonly<Record<string, string>> = { JMP: "JML", JSR: "JSL" };

/** The 6502 family, one CPU per profile. */
export class Mos65xxHandler implements CPUHandler<Mos65xxModeInfo> {
	readonly cpuType: string;
	readonly aliases?: readonly string[];
	readonly endianness = "little" as const;
	readonly addressBits: number;
	readonly bankBits?: number;
	readonly mnemonicSuffixes: readonly string[];

	private readonly instructionMap: ReadonlyMap<string, ReadonlyMap<Mos65xxMode, number>>;

	constructor(private readonly profile: Mos65xxProfile) {
		this.cpuType = profile.cpuType;
		this.aliases = profile.aliases;
		this.addressBits = profile.addressBits;
		this.bankBits = profile.bankBits;
		this.mnemonicSuffixes = Object.keys(profile.suffixes);
		this.instructionMap = this.mergeOpcodeSets(profile.opcodeSets);
	}

	/** Each mnemonic's modes are copied into a new Map: the shared sets are never written to. */
	private mergeOpcodeSets(sets: readonly OpcodeSet[]) {
		const merged = new Map<string, Map<Mos65xxMode, number>>();
		for (const set of sets) {
			for (const [mnemonic, modes] of Object.entries(set)) {
				let target = merged.get(mnemonic);
				if (!target) {
					target = new Map();
					merged.set(mnemonic, target);
				}
				for (const [mode, opcode] of Object.entries(modes) as [Mos65xxMode, number][]) {
					if (target.has(mode)) throw new Error(`The ${this.cpuType}'s opcode sets give ${mnemonic} ${mode} twice.`);
					target.set(mode, opcode);
				}
			}
		}
		return merged;
	}

	isInstruction(mnemonic: string): boolean {
		const baseMnemonic = mnemonic.toUpperCase().split(".")[0];
		return !!baseMnemonic && this.instructionMap.has(baseMnemonic);
	}

	/** Throws unless an address operand is within 0..max. In pass 1, a forward reference is null and is checked in pass 2. */
	private checkAddress(address: number | null, max: AddressMax) {
		if (address !== null && (address < 0 || address > max))
			throw new Error(`${max === 0xff ? "Zero page address" : "Address"} ${address} is out of range ($0..$${getHex(max)}).`);
	}

	/** A zero page address: a relocatable one can't be. */
	private zeroPageAddress(base: string, value: number | RelocValue | null): number | null {
		if (value instanceof RelocValue) throw new Error(`${base} needs a zero page address here, and ${value} is relocatable: it can't be in zero page.`);
		this.checkAddress(value, 0xff);
		return value;
	}

	/**
	 * `info` with its address operand: a number within 0..max, or, for an absolute or long one, a relocatable address:
	 * its offset, with the fixup of its 2 or 3 bytes.
	 */
	private addressInfo(base: string, info: ModeInfo, value: number | RelocValue | null, max: AddressMax): ModeInfo {
		if (max === 0xff) return { ...info, resolvedAddress: this.zeroPageAddress(base, value) };
		if (!(value instanceof RelocValue)) {
			this.checkAddress(value, max);
			return { ...info, resolvedAddress: value };
		}
		if (value.byteShift !== undefined)
			throw new Error(`${base} needs an address here, and ${value} is one byte of a relocatable one: only an immediate (#) takes one.`);
		this.checkAddress(value.offset, max);
		return { ...info, resolvedAddress: value.offset, fixup: { at: 1, size: max === 0xffff ? 2 : 3, value } };
	}

	/** A one-byte operand that isn't an address, `what` in messages: a stack offset, a bank, a signature. */
	private byteOperand(base: string, what: string, value: number | RelocValue | null): number | null {
		if (value instanceof RelocValue)
			throw new Error(`${base} needs a ${what} here, and ${value} is relocatable: its value is only known when it's loaded.`);
		if (value !== null && (value < 0 || value > 0xff)) throw new Error(`${base}: the ${what} ${value} is out of range ($0..$FF).`);
		return value;
	}

	/** An operand that can be an immediate or not: `#$12` or `$12`, the same. */
	private withoutHash(tokens: OperatorStackToken[]) {
		return tokens[0]?.value === "#" ? tokens.slice(1) : tokens;
	}

	/** The 65816's: an address can be long, over $FFFF. */
	private get hasLongAddresses() {
		return this.addressBits > 16;
	}

	/**
	 * Zero page, absolute or long, for a direct or indexed operand (`index` is "", ",X" or ",Y").
	 * A suffix forces it, if the instruction has that form: .b zero page and .w absolute, with the address's low byte or
	 * low 16 bits (the writer says it's in the direct page, the data or program bank), .l long.
	 * Without one, the width the address needs (`addressWidth`), or a wider one the instruction has: `jmp $12` is absolute.
	 */
	private selectAddressMode(
		mnemonic: string,
		modes: ReadonlyMap<Mos65xxMode, number>,
		index: keyof typeof ADDRESS_MODES,
		address: number | RelocValue | null,
		forcedWidth: AddressWidth | null,
		context: InstructionContext | undefined,
	): Mos65xxMode {
		const base = mnemonic.split(".")[0] as string;
		const forms = ADDRESS_MODES[index];
		const modeOf = (width: AddressWidth) => {
			const mode = forms[width - 1];
			return mode && modes.has(mode) ? mode : undefined;
		};

		if (address instanceof RelocValue && (forcedWidth === 1 || (!modeOf(2) && !modeOf(3))))
			throw new Error(`'${mnemonic}' needs a zero page address here, and ${address} is relocatable: it can't be in zero page.`);

		if (forcedWidth) {
			const mode = modeOf(forcedWidth);
			if (!mode) throw new Error(`'${mnemonic}': ${base} has no ${WIDTH_NAMES[forcedWidth]}${index} form.`);
			return mode;
		}

		const width = this.addressWidth(base, address, context);
		const mode = modeOf(width) ?? (width === 1 ? modeOf(2) : undefined);
		if (mode) return mode;
		if (width === 3) {
			const what =
				address instanceof RelocValue
					? `${address} is in another segment, whose bank is only known when it's loaded`
					: `$${getHex(address ?? 0)} is over $FFFF`;
			const bank = base === "PEA" ? "" : ", in the data bank";
			throw new Error(`${base} has no long${index} form, and ${what}: ${base.toLowerCase()}.w takes its low 16 bits${bank}.`);
		}
		// Absolute needed, and only zero page: `stx $12,y`
		const zeroPageMode = modeOf(1);
		if (!zeroPageMode) throw new Error(`Invalid addressing mode for instruction ${mnemonic}`);
		if (address !== null) throw new Error(`${base} has no absolute${index} form, and $${getHex(address as number)} isn't a zero page address.`);
		return zeroPageMode;
	}

	/**
	 * The width an address needs, without a suffix. A number's size: zero page up to $FF, absolute up to $FFFF, long
	 * above. A symbol defined later is absolute in pass 1 (the worst case on the 6502). JMP's and JSR's is absolute:
	 * their target is in the program bank. A relocatable address is absolute in its own segment, and long in another on
	 * the 65816, its bank only known when it's loaded: JMP and JSR can't reach it.
	 */
	private addressWidth(base: string, address: number | RelocValue | null, context: InstructionContext | undefined): AddressWidth {
		const longJump = LONG_JUMPS[base];
		if (address instanceof RelocValue) {
			if (!this.hasLongAddresses || address.byteShift !== undefined || address.segment === context?.relocatableSegment) return 2;
			if (longJump)
				throw new Error(
					`${base} can't reach ${address} with an absolute address, as segment '${address.segment}' is relocatable, its bank only known when it's loaded: ${longJump.toLowerCase()} reaches it.`,
				);
			return 3;
		}
		if (address === null || longJump) return 2;
		if (address <= 0xff) return 1;
		return address <= 0xffff ? 2 : 3;
	}

	/** The operands are read with `operands`: a relocatable address is absolute or long, its fixup recorded. See `addressInfo`. */
	resolveAddressingMode(
		mnemonic: string,
		operandTokens: OperatorStackToken[],
		_resolveValue: (tokens: OperatorStackToken[]) => number | null,
		operands: OperandReader,
		context?: InstructionContext,
	): Mos65xxModeInfo {
		// Check if the base mnemonic is supported. If not, THROW to signal a potential label.
		const parts = mnemonic.split(".");
		const baseMnemonic = parts[0];
		if (!baseMnemonic) throw new Error(`Unknown instruction mnemonic: ${mnemonic}`);

		const instructionModes = this.instructionMap.get(baseMnemonic);
		if (!instructionModes) throw new Error(`Unknown instruction mnemonic: ${mnemonic}`);

		const modeInfo = (mode: Mos65xxMode, resolvedAddress: number | null = 0): ModeInfo => {
			const opcode = instructionModes.get(mode);
			if (opcode === undefined) throw new Error(`Invalid addressing mode for instruction ${mnemonic}`);
			return { mode, opcode, bytes: MODE_BYTES[mode], resolvedAddress };
		};

		const sizeSuffix = parts[1] ?? "";
		let forcedWidth: AddressWidth | null = null;
		if (sizeSuffix) {
			if (!Object.hasOwn(this.profile.suffixes, sizeSuffix)) throw new Error(`'${mnemonic}': the ${this.cpuType} has no '.${sizeSuffix}' suffix.`);
			forcedWidth = this.profile.suffixes[sizeSuffix] ?? null;
		}

		// A suffix sets the size of an address (zero page, absolute or long): any other operand can't take one.
		const widths = this.hasLongAddresses ? "zero page, absolute or long" : "zero page or absolute";
		const rejectSuffix = () => {
			if (sizeSuffix) throw new Error(`'${mnemonic}': .${sizeSuffix} only applies to an address that can be ${widths}.`);
		};

		const numTokens = operandTokens.length;
		const tokenIs = (index: number, value: string) => operandTokens[index]?.value.toUpperCase() === value;

		// 0. A signature byte, `#$12` or `$12`, 0 when left out: the 65816's `BRK`, `COP`, `WDM`
		if (instructionModes.has("SIGNATURE")) {
			rejectSuffix();
			const info = modeInfo("SIGNATURE");
			if (numTokens === 0) return info;
			return { ...info, resolvedAddress: this.byteOperand(baseMnemonic, "signature", operands.value(this.withoutHash(operandTokens))) };
		}

		// 1. Implied (RTS), or accumulator: `ASL A`, or `ASL` alone
		if (numTokens === 0 || (numTokens === 1 && tokenIs(0, "A") && instructionModes.has("ACCUMULATOR"))) {
			const info = modeInfo(instructionModes.has("IMPLIED") ? "IMPLIED" : "ACCUMULATOR");
			rejectSuffix();
			return info;
		}

		// 2. Zero page and relative: `BBR0 $12,label`, split at the first comma outside parentheses
		if (instructionModes.has("ZEROPAGE_RELATIVE")) {
			rejectSuffix();
			const comma = findTopLevelComma(operandTokens);
			if (comma === -1) throw new Error(`${baseMnemonic} takes a zero page address and a branch target: '${baseMnemonic} $12,label'.`);
			const zeroPage = this.zeroPageAddress(baseMnemonic, operands.value(operandTokens.slice(0, comma)));
			return { ...modeInfo("ZEROPAGE_RELATIVE", operands.branchTarget(operandTokens.slice(comma + 1))), zeroPage };
		}

		// 2b. Two banks, the source then the destination, each `$01` or `#$01`: `MVN $01,$02`
		if (instructionModes.has("BLOCK_MOVE")) {
			rejectSuffix();
			const comma = findTopLevelComma(operandTokens);
			if (comma === -1) throw new Error(`${baseMnemonic} takes a source and a destination bank: '${baseMnemonic} $01,$02'.`);
			const bank = (tokens: OperatorStackToken[]) => this.byteOperand(baseMnemonic, "bank", operands.value(this.withoutHash(tokens)));
			const sourceBank = bank(operandTokens.slice(0, comma));
			return { ...modeInfo("BLOCK_MOVE", bank(operandTokens.slice(comma + 1))), sourceBank };
		}

		// 3. Immediate Mode (e.g., LDA #$42), or one byte of a relocatable address (LDA #<label). On two bytes, the
		// 65816's 16-bit widths: a relocatable address in its bank, or one byte of it then 0, as `.dw <label`.
		if (tokenIs(0, "#")) {
			if (forcedWidth === 3) rejectSuffix();
			const width = this.immediateWidth(baseMnemonic, forcedWidth === 3 ? null : forcedWidth);
			if (!width) rejectSuffix();
			const size = width?.bytes ?? 1;
			const info = { ...modeInfo("IMMEDIATE"), bytes: 1 + size, ...(width?.listing && { listing: width.listing }) };
			const value = operands.value(operandTokens.slice(1));
			if (value instanceof RelocValue) {
				const { byteShift } = value;
				if (byteShift !== undefined) return { ...info, resolvedAddress: (value.offset >> byteShift) & 0xff, fixup: { at: 1, size: 1, value } };
				if (size === 1) throw new Error(`${baseMnemonic} #${value}: an immediate is one byte, take one of the relocatable address with <, > or ^.`);
				this.checkAddress(value.offset, 0xffff);
				return { ...info, resolvedAddress: value.offset, fixup: { at: 1, size: 2, value } };
			}
			if (value !== null) assertFitsInBytes(value, size, "Immediate value");
			return { ...info, resolvedAddress: value };
		}

		// 4. Indirect modes: the operand's first `(` closes at its end, `(e)` or `(e,X)`, or right before `,Y`: `(e),Y`.
		// Otherwise its parentheses only group an expression: `lda (2+3)*4,x` (TODO 3.10). Same for `[`: `lda [1,2][1]` (TODO 3.11).
		// The instruction's modes tell (abs) from (zp), and (abs,X) from (zp,X).
		const close = tokenIs(0, "(") || tokenIs(0, "[") ? findClosingBracket(operandTokens, 0) : -1;
		const isIndexedAfter = (index: string) => close !== -1 && close === numTokens - 3 && tokenIs(close + 1, ",") && tokenIs(close + 2, index);
		const isIndirect = close === numTokens - 1 || isIndexedAfter("Y");
		// `[e]` and `[e],Y` are the 65816's indirect long, JML [abs] or LDA [dp]; `[e],X` is no mode.
		if (tokenIs(0, "[") && (isIndirect || isIndexedAfter("X"))) {
			if (!isIndirect) throw new Error(`Invalid addressing mode for instruction ${mnemonic}`);
			rejectSuffix();
			const inner = operandTokens.slice(1, close);
			if (close !== numTokens - 1) return this.addressInfo(baseMnemonic, modeInfo("ZEROPAGE_INDIRECT_LONG_Y"), operands.value(inner), 0xff);
			const isAbsolute = instructionModes.has("ABSOLUTE_INDIRECT_LONG");
			const info = modeInfo(isAbsolute ? "ABSOLUTE_INDIRECT_LONG" : "ZEROPAGE_INDIRECT_LONG");
			return this.addressInfo(baseMnemonic, info, operands.value(inner), isAbsolute ? 0xffff : 0xff);
		}
		if (isIndirect) {
			rejectSuffix();
			const inner = operandTokens.slice(1, close);

			// Indirect Y: (zp),Y, or the 65816's stack relative (sr,S),Y
			if (close !== numTokens - 1) {
				const comma = findTopLevelComma(inner);
				if (comma === -1) return this.addressInfo(baseMnemonic, modeInfo("INDIRECT_Y"), operands.value(inner), 0xff);
				if (comma !== inner.length - 2 || inner[comma + 1]?.value.toUpperCase() !== "S")
					throw new Error(`Invalid addressing mode for instruction ${mnemonic}`);
				const info = modeInfo("STACK_RELATIVE_INDIRECT_Y");
				return { ...info, resolvedAddress: this.byteOperand(baseMnemonic, "stack offset", operands.value(inner.slice(0, comma))) };
			}

			// Indexed: JMP (abs,X), or (zp,X)
			const comma = findTopLevelComma(inner);
			if (comma !== -1) {
				if (comma !== inner.length - 2 || inner[comma + 1]?.value.toUpperCase() !== "X")
					throw new Error(`Invalid addressing mode for instruction ${mnemonic}`);
				const value = operands.value(inner.slice(0, comma));
				const isAbsolute = instructionModes.has("ABSOLUTE_INDIRECT_X");
				return this.addressInfo(baseMnemonic, modeInfo(isAbsolute ? "ABSOLUTE_INDIRECT_X" : "INDIRECT_X"), value, isAbsolute ? 0xffff : 0xff);
			}

			// JMP (abs), or (zp)
			const value = operands.value(inner);
			const isAbsolute = instructionModes.has("INDIRECT");
			return this.addressInfo(baseMnemonic, modeInfo(isAbsolute ? "INDIRECT" : "ZEROPAGE_INDIRECT"), value, isAbsolute ? 0xffff : 0xff);
		}
		// `(e),X` isn't a 65xx mode: most likely a typo for (e,X), so not read as `e,X`.
		if (isIndexedAfter("X")) throw new Error(`Invalid addressing mode for instruction ${mnemonic}: did you mean (zp,X)?`);

		// 5. The 65816's stack relative: LDA $12,S
		if (tokenIs(numTokens - 1, "S") && tokenIs(numTokens - 2, ",")) {
			rejectSuffix();
			const info = modeInfo("STACK_RELATIVE");
			return { ...info, resolvedAddress: this.byteOperand(baseMnemonic, "stack offset", operands.value(operandTokens.slice(0, numTokens - 2))) };
		}

		// 5b. Absolute/Zero Page Indexed Modes (e.g., LDA $1234,X or LDA $40,Y)
		if ((tokenIs(numTokens - 1, "X") || tokenIs(numTokens - 1, "Y")) && tokenIs(numTokens - 2, ",")) {
			const index = tokenIs(numTokens - 1, "X") ? ",X" : ",Y";
			return this.directAddress(mnemonic, instructionModes, index, operands.value(operandTokens.slice(0, numTokens - 2)), forcedWidth, modeInfo, context);
		}

		// 6. Relative Mode (Branches), and the 65816's 16-bit one: BRL, PER
		if (instructionModes.has("RELATIVE") || instructionModes.has("RELATIVE_LONG")) {
			rejectSuffix();
			return modeInfo(instructionModes.has("RELATIVE") ? "RELATIVE" : "RELATIVE_LONG", operands.branchTarget(operandTokens));
		}

		// 6b. An instruction whose only address is long: JML, JSL. The others choose it in `selectAddressMode`.
		if (instructionModes.has("ABSOLUTE_LONG") && !instructionModes.has("ABSOLUTE") && !instructionModes.has("ZEROPAGE")) {
			rejectSuffix();
			return this.addressInfo(baseMnemonic, modeInfo("ABSOLUTE_LONG"), operands.value(operandTokens), 0xffffff);
		}

		// 7. Absolute/Zero Page Direct (e.g., LDA $1234 or LDA MyLabel)
		return this.directAddress(mnemonic, instructionModes, "", operands.value(operandTokens), forcedWidth, modeInfo, context);
	}

	/**
	 * A direct or indexed address operand: zero page, absolute or long, see `selectAddressMode`. In pass 2, it can't be
	 * long if pass 1 made it shorter, a symbol defined after it unknown there.
	 */
	private directAddress(
		mnemonic: string,
		modes: ReadonlyMap<Mos65xxMode, number>,
		index: keyof typeof ADDRESS_MODES,
		value: number | RelocValue | null,
		forcedWidth: AddressWidth | null,
		modeInfo: (mode: Mos65xxMode, resolvedAddress?: number | null) => ModeInfo,
		context: InstructionContext | undefined,
	): Mos65xxModeInfo {
		const base = mnemonic.split(".")[0] as string;
		if (!(value instanceof RelocValue)) this.checkAddress(value, this.hasLongAddresses ? 0xffffff : 0xffff);
		const mode = this.selectAddressMode(mnemonic, modes, index, value, forcedWidth, context);
		const pass1Bytes = context?.pass1Bytes;
		if (pass1Bytes !== undefined && MODE_BYTES[mode] === 4 && pass1Bytes < 4) {
			const operand = value instanceof RelocValue ? `${value}` : `$${getHex(value ?? 0)}`;
			throw new Error(
				`${base} ${operand} needs a long address, but pass 1 made it absolute: a symbol in it is defined after the ${base}. Write ${base.toLowerCase()}.l, or define the symbol earlier.`,
			);
		}
		// A number forced to zero page (.b) or absolute (.w) keeps its low byte or 16 bits, when encoded.
		if (!(value instanceof RelocValue)) {
			const programBank = this.bankBits !== undefined && !!LONG_JUMPS[base] && mode === "ABSOLUTE" && !forcedWidth && !context?.relocatableSegment;
			return { ...modeInfo(mode, value), ...(programBank && { programBank }) };
		}
		return this.addressInfo(base, modeInfo(mode), value, MODE_BYTES[mode] === 4 ? 0xffffff : 0xffff);
	}

	/**
	 * The size of `mnemonic`'s immediate: undefined for one byte, taking no suffix, as on the 6502 and 65C02. The 65816
	 * gives its M / X immediates their width, or the one a suffix forces (`forcedWidth`).
	 */
	protected immediateWidth(_mnemonic: string, _forcedWidth: 1 | 2 | null): ImmediateWidth | undefined {
		return undefined;
	}

	/** Whether `address` is in the bank of the instruction at `pc`: always on a CPU without banks. */
	private inBankOf(address: number, pc: number) {
		if (this.bankBits === undefined) return true;
		const bankSize = 2 ** this.bankBits;
		return Math.floor(address / bankSize) === Math.floor(pc / bankSize);
	}

	/** A branch's target, in the instruction's bank: the 65816 adds the offset there, wrapping. `offset` says which one. */
	private checkBranchBank(modeInfo: ResolvedModeInfo<Mos65xxModeInfo>, offset: string) {
		const { resolvedAddress: target, pc } = modeInfo;
		if (!this.inBankOf(target, pc))
			throw new Error(`Branch target $${getHex(target)} is in another bank than the instruction at $${getHex(pc)}: ${offset} stays in its bank.`);
	}

	/** A branch's offset from the next instruction, as a signed byte (two's complement). */
	private branchOffset(modeInfo: ResolvedModeInfo<Mos65xxModeInfo>) {
		this.checkBranchBank(modeInfo, "a branch");
		const targetAddress = modeInfo.resolvedAddress;
		const offset = targetAddress - (modeInfo.pc + modeInfo.bytes);
		if (offset < -128 || offset > 127)
			throw new Error(`Branch target out of range. Target: $${getHex(targetAddress)}, PC: $${getHex(modeInfo.pc)}, Offset: ${offset}`);
		return offset & 0xff;
	}

	/**
	 * BRL's and PER's offset from the next instruction, in 16 bits: the 65816 adds it in the program bank, wrapping,
	 * so any target in the instruction's bank is reached, and one in another bank never.
	 */
	private longBranchOffset(modeInfo: ResolvedModeInfo<Mos65xxModeInfo>) {
		this.checkBranchBank(modeInfo, "a 16-bit offset");
		return (modeInfo.resolvedAddress - (modeInfo.pc + modeInfo.bytes)) & 0xffff;
	}

	/** JMP's or JSR's absolute target, in the program bank: one in another bank is JML's or JSL's. */
	private checkProgramBank(modeInfo: ResolvedModeInfo<Mos65xxModeInfo>, mnemonic: string) {
		const { resolvedAddress: target, pc } = modeInfo;
		if (this.inBankOf(target, pc)) return;
		const base = mnemonic.toUpperCase().split(".")[0] as string;
		throw new Error(
			`${base} $${getHex(target)} is in another bank than the instruction at $${getHex(pc)}: ${LONG_JUMPS[base]?.toLowerCase()} reaches it, and ${base.toLowerCase()}.w takes its low 16 bits, in the program bank.`,
		);
	}

	/** Pass 2: Encodes the instruction using the resolved mode and address. */
	encodeInstruction(tokens: OperatorStackToken[], modeInfo: ResolvedModeInfo<Mos65xxModeInfo>): number[] {
		if (modeInfo.mode === "RELATIVE") return [modeInfo.opcode, this.branchOffset(modeInfo)];
		if (modeInfo.programBank) this.checkProgramBank(modeInfo, tokens[0]?.value ?? "");

		if (modeInfo.mode === "ZEROPAGE_RELATIVE") {
			const { zeroPage } = modeInfo;
			if (zeroPage == null) throw new Error("Internal error: the zero page address of a bit branch is still unknown in pass 2.");
			return [modeInfo.opcode, zeroPage, this.branchOffset(modeInfo)];
		}

		if (modeInfo.mode === "RELATIVE_LONG") {
			const offset = this.longBranchOffset(modeInfo);
			return [modeInfo.opcode, offset & 0xff, offset >> 8];
		}

		// The bytes are the destination bank, then the source: the reverse of `MVN src,dst`.
		if (modeInfo.mode === "BLOCK_MOVE") {
			const { sourceBank } = modeInfo;
			if (sourceBank == null) throw new Error("Internal error: the source bank of a block move is still unknown in pass 2.");
			return [modeInfo.opcode, modeInfo.resolvedAddress, sourceBank];
		}

		const address = modeInfo.resolvedAddress;

		// Little-endian address encoding
		if (modeInfo.bytes === 2) return [modeInfo.opcode, address & 0xff];
		if (modeInfo.bytes === 3) return [modeInfo.opcode, address & 0xff, (address >> 8) & 0xff];
		if (modeInfo.bytes === 4) return [modeInfo.opcode, address & 0xff, (address >> 8) & 0xff, (address >> 16) & 0xff];
		return [modeInfo.opcode];
	}
}
