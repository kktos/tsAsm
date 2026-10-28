import type { OperatorStackToken } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import { assertFitsInBytes } from "../utils/number.utils";
import { findTopLevelComma } from "../utils/token.utils";
import type { CPUHandler, ModeInfo, ResolvedModeInfo } from "./cpuhandler.interface";
import type { Mos65xxMode, OpcodeSet } from "./mos65xx.opcodes";

/** What makes one 65xx CPU: its name, the opcode sets it's made of, and its mnemonic suffixes. */
export interface Mos65xxProfile {
	cpuType: string;
	/** Merged per mnemonic when the handler is built: a mnemonic and mode given by two sets is an error. */
	opcodeSets: readonly OpcodeSet[];
	/** The address width, in bytes, each suffix forces: `lda.b` zero page, `lda.w` absolute. */
	suffixes: Readonly<Record<string, 1 | 2>>;
}

/** BBR / BBS have two operands: the branch target is in resolvedAddress, the zero page address here. */
export interface Mos65xxModeInfo extends ModeInfo {
	zeroPage?: number | null;
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
};

/** The zero page and absolute modes of a direct or indexed operand. */
const ADDRESS_MODES = {
	"": ["ZEROPAGE", "ABSOLUTE"],
	",X": ["ZEROPAGE_X", "ABSOLUTE_X"],
	",Y": ["ZEROPAGE_Y", "ABSOLUTE_Y"],
} as const satisfies Record<string, readonly [Mos65xxMode, Mos65xxMode]>;

/** The 6502 family, one CPU per profile. */
export class Mos65xxHandler implements CPUHandler<Mos65xxModeInfo> {
	readonly cpuType: string;
	readonly endianness = "little" as const;
	readonly mnemonicSuffixes: readonly string[];

	private readonly instructionMap: ReadonlyMap<string, ReadonlyMap<Mos65xxMode, number>>;

	constructor(private readonly profile: Mos65xxProfile) {
		this.cpuType = profile.cpuType;
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
	private checkAddress(address: number | null, max: 0xff | 0xffff) {
		if (address !== null && (address < 0 || address > max))
			throw new Error(`${max === 0xff ? "Zero page address" : "Address"} ${address} is out of range ($0..$${getHex(max)}).`);
	}

	/** Extracts tokens between two delimiters (e.g., inside parentheses). */
	private extractTokensBetween(tokens: OperatorStackToken[], startVal: string, endVal: string) {
		const start = tokens.findIndex((t) => t.value === startVal);
		const end = tokens.findIndex((t) => t.value === endVal);
		if (start === -1 || end === -1 || start >= end) return [];
		return tokens.slice(start + 1, end);
	}

	/**
	 * Zero page or absolute, for a direct or indexed operand (`index` is "", ",X" or ",Y").
	 * A suffix forces it, if the instruction has that form: .b zero page (with the address's low byte), .w absolute.
	 * Without one: zero page when the address is known, fits, and the instruction has that form, else absolute
	 * (the worst case for an address defined later).
	 */
	private selectAddressMode(
		mnemonic: string,
		modes: ReadonlyMap<Mos65xxMode, number>,
		index: keyof typeof ADDRESS_MODES,
		address: number | null,
		forcedWidth: 1 | 2 | null,
	): Mos65xxMode {
		const base = mnemonic.split(".")[0];
		const [zeroPageMode, absoluteMode] = ADDRESS_MODES[index];
		const hasZeroPage = modes.has(zeroPageMode);
		const hasAbsolute = modes.has(absoluteMode);

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

	resolveAddressingMode(
		mnemonic: string,
		operandTokens: OperatorStackToken[],
		resolveValue: (tokens: OperatorStackToken[]) => number | null,
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
			const zeroPage = resolveValue(operandTokens.slice(0, comma));
			this.checkAddress(zeroPage, 0xff);
			return { ...modeInfo("ZEROPAGE_RELATIVE", resolveValue(operandTokens.slice(comma + 1))), zeroPage };
		}

		// 3. Immediate Mode (e.g., LDA #$42)
		if (tokenIs(0, "#")) {
			rejectSuffix();
			const resolvedAddress = resolveValue(operandTokens.slice(1));
			if (resolvedAddress !== null) assertFitsInBytes(resolvedAddress, 1, "Immediate value");
			return modeInfo("IMMEDIATE", resolvedAddress);
		}

		// 4. Indirect, Indirect Indexed Modes: the instruction's modes tell (abs) from (zp), and (abs,X) from (zp,X)
		if (tokenIs(0, "(")) {
			rejectSuffix();

			// Indirect Y: (zp),Y
			if (tokenIs(numTokens - 1, "Y") && tokenIs(numTokens - 2, ",")) {
				const resolvedAddress = resolveValue(this.extractTokensBetween(operandTokens, "(", ")"));
				const info = modeInfo("INDIRECT_Y", resolvedAddress);
				this.checkAddress(resolvedAddress, 0xff);
				return info;
			}

			if (tokenIs(numTokens - 1, ")")) {
				// Indexed: JMP (abs,X), or (zp,X)
				if (tokenIs(numTokens - 2, "X") && tokenIs(numTokens - 3, ",")) {
					const resolvedAddress = resolveValue(this.extractTokensBetween(operandTokens, "(", ","));
					const isAbsolute = instructionModes.has("ABSOLUTE_INDIRECT_X");
					const info = modeInfo(isAbsolute ? "ABSOLUTE_INDIRECT_X" : "INDIRECT_X", resolvedAddress);
					this.checkAddress(resolvedAddress, isAbsolute ? 0xffff : 0xff);
					return info;
				}

				// JMP (abs), or (zp)
				const resolvedAddress = resolveValue(this.extractTokensBetween(operandTokens, "(", ")"));
				const isAbsolute = instructionModes.has("INDIRECT");
				const info = modeInfo(isAbsolute ? "INDIRECT" : "ZEROPAGE_INDIRECT", resolvedAddress);
				this.checkAddress(resolvedAddress, isAbsolute ? 0xffff : 0xff);
				return info;
			}
			throw new Error(`Invalid addressing mode for instruction ${mnemonic}`);
		}

		// 5. Absolute/Zero Page Indexed Modes (e.g., LDA $1234,X or LDA $40,Y)
		if ((tokenIs(numTokens - 1, "X") || tokenIs(numTokens - 1, "Y")) && tokenIs(numTokens - 2, ",")) {
			const index = tokenIs(numTokens - 1, "X") ? ",X" : ",Y";
			const resolvedAddress = resolveValue(operandTokens.slice(0, numTokens - 2));
			this.checkAddress(resolvedAddress, 0xffff);
			return modeInfo(this.selectAddressMode(mnemonic, instructionModes, index, resolvedAddress, forcedWidth), resolvedAddress);
		}

		// 6. Relative Mode (Branches)
		if (instructionModes.has("RELATIVE")) {
			rejectSuffix();
			return modeInfo("RELATIVE", resolveValue(operandTokens));
		}

		// 7. Absolute/Zero Page Direct (e.g., LDA $1234 or LDA MyLabel)
		const resolvedAddress = resolveValue(operandTokens);
		this.checkAddress(resolvedAddress, 0xffff);
		return modeInfo(this.selectAddressMode(mnemonic, instructionModes, "", resolvedAddress, forcedWidth), resolvedAddress);
	}

	/** A branch's offset from the next instruction, as a signed byte (two's complement). */
	private branchOffset(modeInfo: ResolvedModeInfo<Mos65xxModeInfo>) {
		const targetAddress = modeInfo.resolvedAddress;
		const offset = targetAddress - (modeInfo.pc + modeInfo.bytes);
		if (offset < -128 || offset > 127)
			throw new Error(`Branch target out of range. Target: $${getHex(targetAddress)}, PC: $${getHex(modeInfo.pc)}, Offset: ${offset}`);
		return offset & 0xff;
	}

	/** Pass 2: Encodes the instruction using the resolved mode and address. */
	encodeInstruction(_tokens: OperatorStackToken[], modeInfo: ResolvedModeInfo<Mos65xxModeInfo>): number[] {
		if (modeInfo.mode === "RELATIVE") return [modeInfo.opcode, this.branchOffset(modeInfo)];

		if (modeInfo.mode === "ZEROPAGE_RELATIVE") {
			const { zeroPage } = modeInfo;
			if (zeroPage == null) throw new Error("Internal error: the zero page address of a bit branch is still unknown in pass 2.");
			return [modeInfo.opcode, zeroPage, this.branchOffset(modeInfo)];
		}

		const address = modeInfo.resolvedAddress;

		// Little-endian address encoding
		if (modeInfo.bytes === 2) return [modeInfo.opcode, address & 0xff];
		if (modeInfo.bytes === 3) return [modeInfo.opcode, address & 0xff, (address >> 8) & 0xff];
		return [modeInfo.opcode];
	}
}
