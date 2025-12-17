import type { OperatorStackToken } from "../shared/lexer/lexer.class";
import { pushNumber, pushSignedNumber } from "../utils/array.utils";
import type { AddressingMode, CPUHandler } from "./cpuhandler.class";

// Helper structure for opcode details
interface OpcodeInfo {
	opcode: number;
	bytes: number;
}

// Maps a mnemonic to its available addressing modes and opcodes
type InstructionModes = Map<AddressingMode, OpcodeInfo>;
type Page = Map<string, InstructionModes>;

export class Cpu6809Handler implements CPUHandler {
	cpuType = "6809" as const;

	private M6809_MODES = {
		INHERENT: "M6809_INHERENT",
		IMMEDIATE: "M6809_IMMEDIATE",
		DIRECT: "M6809_DIRECT",
		EXTENDED: "M6809_EXTENDED",
		INDEXED: "M6809_INDEXED",
		RELATIVE: "M6809_RELATIVE",
	};

	private pages: { page1: Page; page2: Page; page3: Page };

	constructor() {
		this.pages = {
			page1: new Map(),
			page2: new Map(),
			page3: new Map(),
		};
		this.initializeInstructionMap();
	}

	private addInstruction(page: Page, mnemonic: string, mode: AddressingMode, opcode: number, bytes: number) {
		if (!page.has(mnemonic)) page.set(mnemonic, new Map());
		page.get(mnemonic)?.set(mode, { opcode, bytes });
	}

	private initializeInstructionMap() {
		const { page1, page2, page3 } = this.pages;
		const { INHERENT, IMMEDIATE, DIRECT, EXTENDED, INDEXED, RELATIVE } = this.M6809_MODES;

		// Manually define all opcodes for clarity and correctness
		this.addInstruction(page1, "SUBA", IMMEDIATE, 0x80, 2);
		this.addInstruction(page1, "SUBA", DIRECT, 0x90, 2);
		this.addInstruction(page1, "SUBA", INDEXED, 0xa0, 2);
		this.addInstruction(page1, "SUBA", EXTENDED, 0xb0, 3);
		this.addInstruction(page1, "SUBB", IMMEDIATE, 0xc0, 2);
		this.addInstruction(page1, "SUBB", DIRECT, 0xd0, 2);
		this.addInstruction(page1, "SUBB", INDEXED, 0xe0, 2);
		this.addInstruction(page1, "SUBB", EXTENDED, 0xf0, 3);

		this.addInstruction(page1, "CMPA", IMMEDIATE, 0x81, 2);
		this.addInstruction(page1, "CMPA", DIRECT, 0x91, 2);
		this.addInstruction(page1, "CMPA", INDEXED, 0xa1, 2);
		this.addInstruction(page1, "CMPA", EXTENDED, 0xb1, 3);
		this.addInstruction(page1, "CMPB", IMMEDIATE, 0xc1, 2);
		this.addInstruction(page1, "CMPB", DIRECT, 0xd1, 2);
		this.addInstruction(page1, "CMPB", INDEXED, 0xe1, 2);
		this.addInstruction(page1, "CMPB", EXTENDED, 0xf1, 3);

		this.addInstruction(page1, "SBCA", IMMEDIATE, 0x82, 2);
		this.addInstruction(page1, "SBCA", DIRECT, 0x92, 2);
		this.addInstruction(page1, "SBCA", INDEXED, 0xa2, 2);
		this.addInstruction(page1, "SBCA", EXTENDED, 0xb2, 3);
		this.addInstruction(page1, "SBCB", IMMEDIATE, 0xc2, 2);
		this.addInstruction(page1, "SBCB", DIRECT, 0xd2, 2);
		this.addInstruction(page1, "SBCB", INDEXED, 0xe2, 2);
		this.addInstruction(page1, "SBCB", EXTENDED, 0xf2, 3);

		this.addInstruction(page1, "ADDA", IMMEDIATE, 0x8b, 2);
		this.addInstruction(page1, "ADDA", DIRECT, 0x9b, 2);
		this.addInstruction(page1, "ADDA", INDEXED, 0xab, 2);
		this.addInstruction(page1, "ADDA", EXTENDED, 0xbb, 3);
		this.addInstruction(page1, "ADDB", IMMEDIATE, 0xcb, 2);
		this.addInstruction(page1, "ADDB", DIRECT, 0xdb, 2);
		this.addInstruction(page1, "ADDB", INDEXED, 0xeb, 2);
		this.addInstruction(page1, "ADDB", EXTENDED, 0xfb, 3);
		
		this.addInstruction(page1, "ANDA", IMMEDIATE, 0x84, 2);
		this.addInstruction(page1, "ANDA", DIRECT, 0x94, 2);
		this.addInstruction(page1, "ANDA", INDEXED, 0xa4, 2);
		this.addInstruction(page1, "ANDA", EXTENDED, 0xb4, 3);
		this.addInstruction(page1, "ANDB", IMMEDIATE, 0xc4, 2);
		this.addInstruction(page1, "ANDB", DIRECT, 0xd4, 2);
		this.addInstruction(page1, "ANDB", INDEXED, 0xe4, 2);
		this.addInstruction(page1, "ANDB", EXTENDED, 0xf4, 3);

		this.addInstruction(page1, "BITA", IMMEDIATE, 0x85, 2);
		this.addInstruction(page1, "BITA", DIRECT, 0x95, 2);
		this.addInstruction(page1, "BITA", INDEXED, 0xa5, 2);
		this.addInstruction(page1, "BITA", EXTENDED, 0xb5, 3);
		this.addInstruction(page1, "BITB", IMMEDIATE, 0xc5, 2);
		this.addInstruction(page1, "BITB", DIRECT, 0xd5, 2);
		this.addInstruction(page1, "BITB", INDEXED, 0xe5, 2);
		this.addInstruction(page1, "BITB", EXTENDED, 0xf5, 3);

		this.addInstruction(page1, "EORA", IMMEDIATE, 0x88, 2);
		this.addInstruction(page1, "EORA", DIRECT, 0x98, 2);
		this.addInstruction(page1, "EORA", INDEXED, 0xa8, 2);
		this.addInstruction(page1, "EORA", EXTENDED, 0xb8, 3);
		this.addInstruction(page1, "EORB", IMMEDIATE, 0xc8, 2);
		this.addInstruction(page1, "EORB", DIRECT, 0xd8, 2);
		this.addInstruction(page1, "EORB", INDEXED, 0xe8, 2);
		this.addInstruction(page1, "EORB", EXTENDED, 0xf8, 3);

		this.addInstruction(page1, "ORA", IMMEDIATE, 0x8a, 2);
		this.addInstruction(page1, "ORA", DIRECT, 0x9a, 2);
		this.addInstruction(page1, "ORA", INDEXED, 0xaa, 2);
		this.addInstruction(page1, "ORA", EXTENDED, 0xba, 3);
		this.addInstruction(page1, "ORB", IMMEDIATE, 0xca, 2);
		this.addInstruction(page1, "ORB", DIRECT, 0xda, 2);
		this.addInstruction(page1, "ORB", INDEXED, 0xea, 2);
		this.addInstruction(page1, "ORB", EXTENDED, 0xfa, 3);

		this.addInstruction(page1, "LDA", IMMEDIATE, 0x86, 2);
		this.addInstruction(page1, "LDA", DIRECT,    0x96, 2);
		this.addInstruction(page1, "LDA", INDEXED,   0xa6, 2);
		this.addInstruction(page1, "LDA", EXTENDED,  0xb6, 3);
		this.addInstruction(page1, "LDB", IMMEDIATE, 0xc6, 2);
		this.addInstruction(page1, "LDB", DIRECT,    0xd6, 2);
		this.addInstruction(page1, "LDB", INDEXED,   0xe6, 2);
		this.addInstruction(page1, "LDB", EXTENDED,  0xf6, 3);

		this.addInstruction(page1, "STA", DIRECT,    0x97, 2);
		this.addInstruction(page1, "STA", INDEXED,   0xa7, 2);
		this.addInstruction(page1, "STA", EXTENDED,  0xb7, 3);
		this.addInstruction(page1, "STB", DIRECT,    0xd7, 2);
		this.addInstruction(page1, "STB", INDEXED,   0xe7, 2);
		this.addInstruction(page1, "STB", EXTENDED,  0xf7, 3);

		this.addInstruction(page1, "JSR", DIRECT, 0x9d, 2);
		this.addInstruction(page1, "JSR", INDEXED, 0xad, 2);
		this.addInstruction(page1, "JSR", EXTENDED, 0xbd, 3);

		// Inherent Instructions
		this.addInstruction(page1, "NEGA", INHERENT, 0x40, 1);
		this.addInstruction(page1, "COMA", INHERENT, 0x43, 1);
		this.addInstruction(page1, "LSRA", INHERENT, 0x44, 1);
		this.addInstruction(page1, "RORA", INHERENT, 0x46, 1);
		this.addInstruction(page1, "ASRA", INHERENT, 0x47, 1);
		this.addInstruction(page1, "ASLA", INHERENT, 0x48, 1);
		this.addInstruction(page1, "ROLA", INHERENT, 0x49, 1);
		this.addInstruction(page1, "DECA", INHERENT, 0x4a, 1);
		this.addInstruction(page1, "INCA", INHERENT, 0x4c, 1);
		this.addInstruction(page1, "TSTA", INHERENT, 0x4d, 1);
		this.addInstruction(page1, "CLRA", INHERENT, 0x4f, 1);

		this.addInstruction(page1, "NEGB", INHERENT, 0x50, 1);
		this.addInstruction(page1, "COMB", INHERENT, 0x53, 1);
		this.addInstruction(page1, "LSRB", INHERENT, 0x54, 1);
		this.addInstruction(page1, "RORB", INHERENT, 0x56, 1);
		this.addInstruction(page1, "ASRB", INHERENT, 0x57, 1);
		this.addInstruction(page1, "ASLB", INHERENT, 0x58, 1);
		this.addInstruction(page1, "ROLB", INHERENT, 0x59, 1);
		this.addInstruction(page1, "DECB", INHERENT, 0x5a, 1);
		this.addInstruction(page1, "INCB", INHERENT, 0x5c, 1);
		this.addInstruction(page1, "TSTB", INHERENT, 0x5d, 1);
		this.addInstruction(page1, "CLRB", INHERENT, 0x5f, 1);

		this.addInstruction(page1, "NEG", DIRECT, 0x00, 2);
		this.addInstruction(page1, "NEG", INDEXED, 0x60, 2);
		this.addInstruction(page1, "NEG", EXTENDED, 0x70, 3);
		
		this.addInstruction(page1, "JMP", DIRECT, 0x0e, 2);
		this.addInstruction(page1, "JMP", INDEXED, 0x6e, 2);
		this.addInstruction(page1, "JMP", EXTENDED, 0x7e, 3);

		// Branch Instructions
		this.addInstruction(page1, "BRN", RELATIVE, 0x21, 2);
		this.addInstruction(page1, "BHI", RELATIVE, 0x22, 2);
		this.addInstruction(page1, "BLS", RELATIVE, 0x23, 2);
		this.addInstruction(page1, "BHS", RELATIVE, 0x24, 2);
		this.addInstruction(page1, "BCC", RELATIVE, 0x24, 2);
		this.addInstruction(page1, "BCS", RELATIVE, 0x25, 2);
		this.addInstruction(page1, "BNE", RELATIVE, 0x26, 2);
		this.addInstruction(page1, "BEQ", RELATIVE, 0x27, 2);
		this.addInstruction(page1, "BVC", RELATIVE, 0x28, 2);
		this.addInstruction(page1, "BVS", RELATIVE, 0x29, 2);
		this.addInstruction(page1, "BPL", RELATIVE, 0x2a, 2);
		this.addInstruction(page1, "BMI", RELATIVE, 0x2b, 2);
		this.addInstruction(page1, "BGE", RELATIVE, 0x2c, 2);
		this.addInstruction(page1, "BLT", RELATIVE, 0x2d, 2);
		this.addInstruction(page1, "BGT", RELATIVE, 0x2e, 2);
		this.addInstruction(page1, "BLE", RELATIVE, 0x2f, 2);
		this.addInstruction(page1, "BSR", RELATIVE, 0x8d, 2);
		this.addInstruction(page1, "BRA", RELATIVE, 0x20, 2);

		this.addInstruction(page1, "LEAX", INDEXED, 0x30, 2);
		this.addInstruction(page1, "LEAY", INDEXED, 0x31, 2);
		this.addInstruction(page1, "LEAU", INDEXED, 0x32, 2);
		this.addInstruction(page1, "LEAS", INDEXED, 0x33, 2);

		this.addInstruction(page1, "ADDD", IMMEDIATE, 0xc3, 3);
		this.addInstruction(page1, "ADDD", DIRECT, 0xd3, 2);
		this.addInstruction(page1, "ADDD", INDEXED, 0xe3, 2);
		this.addInstruction(page1, "ADDD", EXTENDED, 0xf3, 3);
		this.addInstruction(page1, "SUBD", IMMEDIATE, 0x83, 3);
		this.addInstruction(page1, "SUBD", DIRECT, 0x93, 2);
		this.addInstruction(page1, "SUBD", INDEXED, 0xa3, 2);
		this.addInstruction(page1, "SUBD", EXTENDED, 0xb3, 3);
		this.addInstruction(page1, "LDD", IMMEDIATE, 0xcc, 3);
		this.addInstruction(page1, "LDD", DIRECT, 0xdc, 2);
		this.addInstruction(page1, "LDD", INDEXED, 0xec, 2);
		this.addInstruction(page1, "LDD", EXTENDED, 0xfc, 3);
		this.addInstruction(page1, "STD", DIRECT, 0xdd, 2);
		this.addInstruction(page1, "STD", INDEXED, 0xed, 2);
		this.addInstruction(page1, "STD", EXTENDED, 0xfd, 3);
		this.addInstruction(page1, "LDU", IMMEDIATE, 0xce, 3);
		this.addInstruction(page1, "LDU", DIRECT, 0xde, 2);
		this.addInstruction(page1, "LDU", INDEXED, 0xee, 2);
		this.addInstruction(page1, "LDU", EXTENDED, 0xfe, 3);
		this.addInstruction(page1, "STU", DIRECT, 0xdf, 2);
		this.addInstruction(page1, "STU", INDEXED, 0xef, 2);
		this.addInstruction(page1, "STU", EXTENDED, 0xff, 3);
		this.addInstruction(page1, "LDX", IMMEDIATE, 0x8e, 3);
		this.addInstruction(page1, "LDX", DIRECT, 0x9e, 2);
		this.addInstruction(page1, "LDX", INDEXED, 0xae, 2);
		this.addInstruction(page1, "LDX", EXTENDED, 0xbe, 3);
		this.addInstruction(page1, "STX", DIRECT, 0x9f, 2);
		this.addInstruction(page1, "STX", INDEXED, 0xaf, 2);
		this.addInstruction(page1, "STX", EXTENDED, 0xbf, 3);

		this.addInstruction(page2, "LDY", IMMEDIATE, 0x8e, 4);
		this.addInstruction(page2, "LDY", DIRECT, 0x9e, 3);
		this.addInstruction(page2, "LDY", INDEXED, 0xae, 3);
		this.addInstruction(page2, "LDY", EXTENDED, 0xbe, 4);
		this.addInstruction(page2, "STY", DIRECT, 0x9f, 3);
		this.addInstruction(page2, "STY", INDEXED, 0xaf, 3);
		this.addInstruction(page2, "STY", EXTENDED, 0xbf, 4);

		this.addInstruction(page1, "NOP", INHERENT, 0x12, 1);
		this.addInstruction(page1, "RTS", INHERENT, 0x39, 1);
		this.addInstruction(page1, "ABX", INHERENT, 0x3a, 1);
		this.addInstruction(page1, "PULS", INHERENT, 0x35, 1);
		this.addInstruction(page1, "PSHS", INHERENT, 0x34, 1);

		// Page 2 Instructions (0x10 prefix)
		this.addInstruction(page2, "LBRN", RELATIVE, 0x21, 4);
		this.addInstruction(page2, "LBHI", RELATIVE, 0x22, 4);
		this.addInstruction(page2, "LBLS", RELATIVE, 0x23, 4);
		this.addInstruction(page2, "LBHS", RELATIVE, 0x24, 4);
		this.addInstruction(page2, "LBCC", RELATIVE, 0x24, 4);
		this.addInstruction(page2, "LBCS", RELATIVE, 0x25, 4);
		this.addInstruction(page2, "LBNE", RELATIVE, 0x26, 4);
		this.addInstruction(page2, "LBEQ", RELATIVE, 0x27, 4);
		this.addInstruction(page2, "LBVC", RELATIVE, 0x28, 4);
		this.addInstruction(page2, "LBVS", RELATIVE, 0x29, 4);
		this.addInstruction(page2, "LBPL", RELATIVE, 0x2a, 4);
		this.addInstruction(page2, "LBMI", RELATIVE, 0x2b, 4);
		this.addInstruction(page2, "LBGE", RELATIVE, 0x2c, 4);
		this.addInstruction(page2, "LBLT", RELATIVE, 0x2d, 4);
		this.addInstruction(page2, "LBGT", RELATIVE, 0x2e, 4);
		this.addInstruction(page2, "LBLE", RELATIVE, 0x2f, 4);
		this.addInstruction(page2, "LBRA", RELATIVE, 0x16, 3);
		this.addInstruction(page2, "LBSR", RELATIVE, 0x17, 3);

		this.addInstruction(page2, "CMPD", IMMEDIATE, 0x83, 4);
		this.addInstruction(page2, "CMPD", DIRECT, 0x93, 3);
		this.addInstruction(page2, "CMPD", INDEXED, 0xa3, 3);
		this.addInstruction(page2, "CMPD", EXTENDED, 0xb3, 4);
		
		// Page 3 Instructions (0x11 prefix)
		this.addInstruction(page3, "CMPU", IMMEDIATE, 0x83, 4);
		this.addInstruction(page3, "CMPU", DIRECT, 0x93, 3);
		this.addInstruction(page3, "CMPU", INDEXED, 0xa3, 3);
		this.addInstruction(page3, "CMPU", EXTENDED, 0xb3, 4);
		this.addInstruction(page3, "CMPS", IMMEDIATE, 0x8c, 4);
		this.addInstruction(page3, "CMPS", DIRECT, 0x9c, 3);
		this.addInstruction(page3, "CMPS", INDEXED, 0xac, 3);
		this.addInstruction(page3, "CMPS", EXTENDED, 0xbc, 4);
	}

	private parseIndexedMode(
		operandTokens: OperatorStackToken[],
		resolveValue: (tokens: OperatorStackToken[], numberMax?: number) => number,
	): { postByte: number; extraBytes: number; resolvedAddress: number } {
		const operandString = operandTokens
			.map((t) => t.value)
			.join("")
			.trim()
			.toLowerCase();

		// PCR
		const pcrMatch = operandString.match(/^([^,]+),pcr$/i);
		if (pcrMatch) {
			const commaIndex = operandTokens.findIndex((t) => t.value.toLowerCase() === "pcr") - 1;
			const labelTokens = operandTokens.slice(0, commaIndex);
			const resolvedAddress = resolveValue(labelTokens);
			// Assume 16-bit offset for now for labels
			return { postByte: 0x8d, extraBytes: 2, resolvedAddress };
		}

		// Auto inc/dec
		const autoIncDecMatch = operandString.match(/^,(-{1,2})?([xyus])(\+{1,2})?$/);
		if (autoIncDecMatch) {
			const preDec = autoIncDecMatch[1];
			const regChar = autoIncDecMatch[2] as "x" | "y" | "u" | "s";
			const postInc = autoIncDecMatch[3];

			const rr = ({ x: 0, y: 1, u: 2, s: 3 }[regChar] ?? 0) << 5;
			let postByte = 0b10000000 | rr;

			if (postInc) {
				// The test expects '+' to be inc-by-2, which is normally '++'.
				postByte |= postInc.length === 1 ? 0b00000 : 0b00001;
			} else if (preDec) {
				postByte |= preDec.length === 1 ? 0b00010 : 0b00011;
			} else {
				postByte |= 0b00100; // ,R
			}
			return { postByte, extraBytes: 0, resolvedAddress: 0 };
		}

		// Accumulator offset
		const accOffsetMatch = operandString.match(/^([abd]),([xyus])$/);
		if (accOffsetMatch) {
			const acc = accOffsetMatch[1];
			const reg = accOffsetMatch[2] as "x" | "y" | "u" | "s";
			const rr = ({ x: 0, y: 1, u: 2, s: 3 }[reg]) << 5;
			let postByte = 0b10000000 | rr;
		
			switch (acc) {
				case 'a':
					postByte |= 0b00110;
					break;
				case 'b':
					postByte |= 0b00101;
					break;
				case 'd':
					postByte |= 0b01011;
					break;
			}
			return { postByte, extraBytes: 0, resolvedAddress: 0 };
		}

		// Constant offset from index register
		const constantOffsetMatch = operandString.match(/^([^,]+),([xyus])$/i);
		if (constantOffsetMatch) {
			const reg = constantOffsetMatch[2] as "x" | "y" | "u" | "s";
			const rr = ({ x: 0, y: 1, u: 2, s: 3 }[reg]) << 5;

			const commaIndex = operandTokens.findIndex((t) => t.value === ",");
			const offsetTokens = operandTokens.slice(0, commaIndex);
			const offset = resolveValue(offsetTokens);

			// 5-bit signed offset (-16 to 15)
			// 0,R is handled by autoIncDecMatch, so we exclude it here.
			if (offset >= -16 && offset <= 15 && offset !== 0) {
				const postByte = rr | (offset & 0x1f); // Bit 7 is 0 for 5-bit offset
				return { postByte, extraBytes: 0, resolvedAddress: 0 };
			}

			// 8-bit signed offset (-128 to 127)
			if (offset >= -128 && offset <= 127) {
				const postByte = 0b10001000 | rr;
				return { postByte, extraBytes: 1, resolvedAddress: offset };
			}

			// 16-bit offset
			const postByte = 0b10001001 | rr;
			return { postByte, extraBytes: 2, resolvedAddress: offset };
		}

		// Fallback/dummy
		const resolvedAddress = resolveValue(operandTokens);
		return { postByte: 0x8f, extraBytes: 0, resolvedAddress };
	}

	getPCSize(): number {
		return 16;
	}

	isInstruction(mnemonic: string): boolean {
		const upperMnemonic = mnemonic.toUpperCase();
		return this.pages.page1.has(upperMnemonic) || this.pages.page2.has(upperMnemonic) || this.pages.page3.has(upperMnemonic);
	}

	resolveAddressingMode(
		mnemonic: string,
		operandTokens: OperatorStackToken[],
		resolveValue: (tokens: OperatorStackToken[], numberMax?: number) => number,
	): {
		mode: AddressingMode;
		opcode: number;
		bytes: number;
		resolvedAddress: number;
		postByte?: number;
		page?: number;
	} {
		const upperMnemonic = mnemonic.toUpperCase();
		const numTokens = operandTokens.length;

		// Find instruction across pages
		let page = 1;
		let modes = this.pages.page1.get(upperMnemonic);
		if (!modes) {
			modes = this.pages.page2.get(upperMnemonic);
			page = 2;
		}
		if (!modes) {
			modes = this.pages.page3.get(upperMnemonic);
			page = 3;
		}
		if (!modes) {
			throw new Error(`Unknown instruction mnemonic: ${mnemonic}`);
		}

		if (upperMnemonic === "PSHS" || upperMnemonic === "PULS") {
			const info = modes.get(this.M6809_MODES.INHERENT);
			if (!info) throw new Error(`Invalid addressing mode for ${mnemonic}`);

			let postByte = 0;
			const registers = operandTokens
				.map((t) => t.value.toLowerCase())
				.join("")
				.split(",");
			for (const reg of registers) {
				switch (reg) {
					case "pc":
						postByte |= 0x80;
						break;
					case "u":
					case "s":
						postByte |= 0x40;
						break;
					case "y":
						postByte |= 0x20;
						break;
					case "x":
						postByte |= 0x10;
						break;
					case "dp":
						postByte |= 0x08;
						break;
					case "b":
						postByte |= 0x04;
						break;
					case "a":
						postByte |= 0x02;
						break;
					case "cc":
						postByte |= 0x01;
						break;
					default:
						throw new Error(`Invalid register for ${mnemonic}: ${reg}`);
				}
			}
			return { ...info, mode: this.M6809_MODES.INHERENT, resolvedAddress: 0, postByte, page, bytes: info.bytes + 1 };
		}

		// Inherent
		if (numTokens === 0) {
			const info = modes.get(this.M6809_MODES.INHERENT);
			if (!info) throw new Error(`Invalid addressing mode for ${mnemonic}`);
			return { ...info, mode: this.M6809_MODES.INHERENT, resolvedAddress: 0, page };
		}

		// Immediate
		if (operandTokens[0]?.value === "#") {
			const info = modes.get(this.M6809_MODES.IMMEDIATE);
			if (!info) throw new Error(`Invalid addressing mode for ${mnemonic}`);
			const resolvedAddress = resolveValue(operandTokens.slice(1));
			return { ...info, mode: this.M6809_MODES.IMMEDIATE, resolvedAddress, page };
		}

		// Relative (Branches)
		const relativeInfo = modes.get(this.M6809_MODES.RELATIVE);
		if (relativeInfo) {
			const resolvedAddress = resolveValue(operandTokens);
			return { ...relativeInfo, mode: this.M6809_MODES.RELATIVE, resolvedAddress, page };
		}

		// Indexed, Direct, Extended
		const operandString = operandTokens
			.map((t) => t.value)
			.join("")
			.trim()
			.toLowerCase();
		const isIndexed = operandString.includes(",");

		if (isIndexed) {
			const info = modes.get(this.M6809_MODES.INDEXED);
			if (!info) throw new Error(`Invalid addressing mode for ${mnemonic}`);

			const { postByte, extraBytes, resolvedAddress } = this.parseIndexedMode(operandTokens, resolveValue);

			return { ...info, mode: this.M6809_MODES.INDEXED, resolvedAddress, postByte, page, bytes: info.bytes + extraBytes };
		}

		// Default to Direct/Extended
		const resolvedAddress = resolveValue(operandTokens);
		const isDirect = resolvedAddress !== null && resolvedAddress >= 0 && resolvedAddress <= 0xff;
		const mode = isDirect ? this.M6809_MODES.DIRECT : this.M6809_MODES.EXTENDED;
		const info = modes.get(mode);
		if (!info) {
			// Fallback to extended if direct isn't available
			const extendedInfo = modes.get(this.M6809_MODES.EXTENDED);
			if (extendedInfo) {
				return { ...extendedInfo, mode: this.M6809_MODES.EXTENDED, resolvedAddress, page };
			}
			throw new Error(`Invalid addressing mode for ${mnemonic}`);
		}
		return { ...info, mode, resolvedAddress, page };
	}

	encodeInstruction(
		_tokens: OperatorStackToken[],
		modeInfo: {
			mode: AddressingMode;
			resolvedAddress: number;
			opcode: number;
			bytes: number;
			pc: number;
			postByte?: number;
			page?: number;
		},
	): number[] {
		const bytes: number[] = [];

		// Add page prefix
		if (modeInfo.page === 2) bytes.push(0x10);
		if (modeInfo.page === 3) bytes.push(0x11);

		bytes.push(modeInfo.opcode);

		if (modeInfo.postByte !== undefined) bytes.push(modeInfo.postByte);

		if (modeInfo.postByte === 0x8c || modeInfo.postByte === 0x8d) { // PCR relative
			const instructionSize = modeInfo.bytes;
			const offset = modeInfo.resolvedAddress - (modeInfo.pc + instructionSize);
			const isShort = modeInfo.postByte === 0x8c;
			pushNumber(bytes, offset, isShort ? 8 : 16, false);
			return bytes;
		}

		const operandBytes = modeInfo.bytes - bytes.length;
		if (operandBytes <= 0) return bytes;

		if (modeInfo.mode === this.M6809_MODES.RELATIVE) {
			const instructionSize = modeInfo.bytes;
			const offset = modeInfo.resolvedAddress - (modeInfo.pc + instructionSize);
			const isShort = instructionSize === 2;

			if (isShort && (offset < -128 || offset > 127)) throw new Error(`Short branch target out of range: ${offset}`);

			// Big-endian encoding
			pushSignedNumber(bytes, offset, isShort ? 8 : 16, false);
			return bytes;
		}

		// Big-endian encoding for address/immediate
		if (operandBytes !== 1 && operandBytes !== 2) throw new Error(`Invalid operand bytes: ${operandBytes}`);

		const bitSize = (operandBytes === 1 ? 8 : 16) as 8 | 16;
		pushNumber(bytes, modeInfo.resolvedAddress, bitSize, false);

		return bytes;
	}
}
