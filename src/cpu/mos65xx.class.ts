import { RelocValue } from "../assembler/reloc-value.class";
import type { OperatorStackToken } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import { assertFitsInBytes } from "../utils/number.utils";
import { findClosingBracket, findTopLevelComma } from "../utils/token.utils";
import type { CPUHandler, ModeInfo, OperandReader, ResolvedModeInfo } from "./cpuhandler.interface";
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
	/** The address width, in bytes, each suffix forces: `lda.b` zero page, `lda.w` absolute. */
	suffixes: Readonly<Record<string, 1 | 2>>;
}

/**
 * BBR / BBS have two operands: the branch target is in resolvedAddress, the zero page address here. MVN / MVP too:
 * the destination bank in resolvedAddress, the source bank here.
 */
export interface Mos65xxModeInfo extends ModeInfo {
	zeroPage?: number | null;
	sourceBank?: number | null;
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

/** The zero page and absolute modes of a direct or indexed operand. */
const ADDRESS_MODES = {
	"": ["ZEROPAGE", "ABSOLUTE"],
	",X": ["ZEROPAGE_X", "ABSOLUTE_X"],
	",Y": ["ZEROPAGE_Y", "ABSOLUTE_Y"],
} as const satisfies Record<string, readonly [Mos65xxMode, Mos65xxMode]>;

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

	/**
	 * Zero page or absolute, for a direct or indexed operand (`index` is "", ",X" or ",Y").
	 * A suffix forces it, if the instruction has that form: .b zero page (with the address's low byte), .w absolute.
	 * Without one: zero page when the address is known, fits, and the instruction has that form, else absolute
	 * (the worst case for an address defined later). A relocatable address is absolute: its address is only known when
	 * it's loaded.
	 */
	private selectAddressMode(
		mnemonic: string,
		modes: ReadonlyMap<Mos65xxMode, number>,
		index: keyof typeof ADDRESS_MODES,
		address: number | RelocValue | null,
		forcedWidth: 1 | 2 | null,
	): Mos65xxMode {
		const base = mnemonic.split(".")[0];
		const [zeroPageMode, absoluteMode] = ADDRESS_MODES[index];
		const hasZeroPage = modes.has(zeroPageMode);
		const hasAbsolute = modes.has(absoluteMode);

		if (address instanceof RelocValue) {
			if (forcedWidth === 1 || !hasAbsolute)
				throw new Error(`'${mnemonic}' needs a zero page address here, and ${address} is relocatable: it can't be in zero page.`);
			return absoluteMode;
		}

		if (forcedWidth === 1) {
			if (!hasZeroPage) throw new Error(`'${mnemonic}': ${base} has no zero page${index} form.`);
			return zeroPageMode;
		}
		if (forcedWidth === 2) {
			if (!hasAbsolute) throw new Error(`'${mnemonic}': ${base} has no absolute${index} form.`);
			return absoluteMode;
		}

		const fitsZeroPage = address !== null && address >= 0x00 && address <= 0xff;
		if (hasZeroPage && (fitsZeroPage || !hasAbsolute)) {
			if (address !== null && !fitsZeroPage) throw new Error(`${base} has no absolute${index} form, and $${getHex(address)} isn't a zero page address.`);
			return zeroPageMode;
		}
		if (hasAbsolute) return absoluteMode;
		throw new Error(`Invalid addressing mode for instruction ${mnemonic}`);
	}

	/** The operands are read with `operands`: a relocatable address is absolute, its fixup recorded. See `addressInfo`. */
	resolveAddressingMode(
		mnemonic: string,
		operandTokens: OperatorStackToken[],
		_resolveValue: (tokens: OperatorStackToken[]) => number | null,
		operands: OperandReader,
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
		let forcedWidth: 1 | 2 | null = null;
		if (sizeSuffix) {
			if (!Object.hasOwn(this.profile.suffixes, sizeSuffix)) throw new Error(`'${mnemonic}': the ${this.cpuType} has no '.${sizeSuffix}' suffix.`);
			forcedWidth = this.profile.suffixes[sizeSuffix] ?? null;
		}

		// A suffix sets the size of an address (zero page or absolute): any other operand can't take one.
		const rejectSuffix = () => {
			if (sizeSuffix) throw new Error(`'${mnemonic}': .${sizeSuffix} only applies to an address that can be zero page or absolute.`);
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
			const width = this.immediateWidth(baseMnemonic, forcedWidth);
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
			return this.directAddress(mnemonic, instructionModes, index, operands.value(operandTokens.slice(0, numTokens - 2)), forcedWidth, modeInfo);
		}

		// 6. Relative Mode (Branches), and the 65816's 16-bit one: BRL, PER
		if (instructionModes.has("RELATIVE") || instructionModes.has("RELATIVE_LONG")) {
			rejectSuffix();
			return modeInfo(instructionModes.has("RELATIVE") ? "RELATIVE" : "RELATIVE_LONG", operands.branchTarget(operandTokens));
		}

		// 6b. An instruction whose only address is long: JML, JSL. The others choose it with 4.18.
		if (instructionModes.has("ABSOLUTE_LONG") && !instructionModes.has("ABSOLUTE") && !instructionModes.has("ZEROPAGE")) {
			rejectSuffix();
			return this.addressInfo(baseMnemonic, modeInfo("ABSOLUTE_LONG"), operands.value(operandTokens), 0xffffff);
		}

		// 7. Absolute/Zero Page Direct (e.g., LDA $1234 or LDA MyLabel)
		return this.directAddress(mnemonic, instructionModes, "", operands.value(operandTokens), forcedWidth, modeInfo);
	}

	/** A direct or indexed address operand: zero page or absolute, see `selectAddressMode`. */
	private directAddress(
		mnemonic: string,
		modes: ReadonlyMap<Mos65xxMode, number>,
		index: keyof typeof ADDRESS_MODES,
		value: number | RelocValue | null,
		forcedWidth: 1 | 2 | null,
		modeInfo: (mode: Mos65xxMode, resolvedAddress?: number | null) => ModeInfo,
	): ModeInfo {
		if (!(value instanceof RelocValue)) this.checkAddress(value, 0xffff);
		const mode = this.selectAddressMode(mnemonic, modes, index, value, forcedWidth);
		// A number forced to zero page (.b) keeps its low byte; a relocatable address is absolute.
		if (!(value instanceof RelocValue)) return modeInfo(mode, value);
		return this.addressInfo(mnemonic.split(".")[0] as string, modeInfo(mode), value, 0xffff);
	}

	/**
	 * The size of `mnemonic`'s immediate: undefined for one byte, taking no suffix, as on the 6502 and 65C02. The 65816
	 * gives its M / X immediates their width, or the one a suffix forces (`forcedWidth`).
	 */
	protected immediateWidth(_mnemonic: string, _forcedWidth: 1 | 2 | null): ImmediateWidth | undefined {
		return undefined;
	}

	/** A branch's offset from the next instruction, as a signed byte (two's complement). */
	private branchOffset(modeInfo: ResolvedModeInfo<Mos65xxModeInfo>) {
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
		const { resolvedAddress: target, pc } = modeInfo;
		if (Math.floor(target / 0x10000) !== Math.floor(pc / 0x10000))
			throw new Error(`Branch target $${getHex(target)} is in another bank than the instruction at $${getHex(pc)}: a 16-bit offset stays in its bank.`);
		return (target - (pc + modeInfo.bytes)) & 0xffff;
	}

	/** Pass 2: Encodes the instruction using the resolved mode and address. */
	encodeInstruction(_tokens: OperatorStackToken[], modeInfo: ResolvedModeInfo<Mos65xxModeInfo>): number[] {
		if (modeInfo.mode === "RELATIVE") return [modeInfo.opcode, this.branchOffset(modeInfo)];

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
