import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Cpu65816Handler, P65816 } from "../cpu/cpu65816.class";
import { Mos65xxHandler } from "../cpu/mos65xx.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import type { AsmError } from "../utils/error.utils";
import { MockFileHandler } from "./mockfilehandler.class";

/** `rep #$30`'s bytes: assembled, in native mode. */
const REP_30 = [0xc2, 0x30];
const EMULATION_REP =
	"REP #$30 can't make the accumulator and the index registers 16-bit in emulation mode: switch to native mode with clc / xce, or say the code runs in it with .native.";
const UNKNOWN_REP =
	"REP #$30 needs the 65816's mode, unknown since an XCE without clc or sec right before it: set it with clc / xce, sec / xce, .native or .emulation.";

const newAssembler = (start = 0x8000) =>
	new Assembler([new Cpu65816Handler(), new Cpu65C02Handler(), new Cpu6502Handler()], new MockFileHandler(), {
		logger: new Logger({ sink: new MemorySink(), enabled: false }),
		segments: [{ name: "CODE", start, size: 0, resizable: true }],
	});

/** The CODE segment's bytes, assembled by a 65816 from `start`. */
const assemble = (source: string, start?: number) =>
	newAssembler(start)
		.assemble(source)
		.find((s) => s.name === "CODE")?.data ?? [];

describe("65816", () => {
	describe("its CPU", () => {
		it("should build from its profile, each of the 256 opcodes given by one of its sets", () => {
			const opcodes = P65816.opcodeSets.flatMap((set) => Object.values(set).flatMap((modes) => Object.values(modes)));
			expect(new Mos65xxHandler(P65816).cpuType).toBe("65816");
			expect(new Set(opcodes).size).toBe(256);
		});

		it.each(["65816", "65c816", "65C816"])("should be selected by .cpu %s", (name) => {
			const assembler = newAssembler();
			assembler.assemble(`
				.cpu 6502
				.cpu ${name}
			`);
			expect(assembler.getCPUHandler()).toBeInstanceOf(Cpu65816Handler);
		});

		it("should be named with its alias in the unknown CPU error, and the alias can't be another CPU's name", () => {
			expect(() => newAssembler().assemble(".cpu 65802")).toThrow("Unknown CPU name '65802': the CPUs are 65816 (65C816), 65C02, 6502.");
			const other = Object.assign(new Cpu6502Handler(), { cpuType: "65C816" });
			expect(() => new Assembler([new Cpu65816Handler(), other], new MockFileHandler())).toThrow("Two CPUs are named '65C816'.");
		});

		it("should not have Rockwell's bit instructions, whose opcodes it uses", () => {
			const cpu = new Cpu65816Handler();
			expect(["RMB0", "SMB7", "BBR0", "BBS7"].filter((mnemonic) => cpu.isInstruction(mnemonic))).toEqual([]);
			expect(cpu.isInstruction("STP")).toBe(true);
		});
	});

	describe("its instructions", () => {
		it("should assemble the implied ones", () => {
			const source = `
				phb
				phd
				phk
				plb
				pld
				rtl
				tcd
				tcs
				tdc
				tsc
				txy
				tyx
				xba
				xce
			`;
			expect(assemble(source)).toEqual([0x8b, 0x0b, 0x4b, 0xab, 0x2b, 0x6b, 0x5b, 0x1b, 0x7b, 0x3b, 0x9b, 0xbb, 0xeb, 0xfb]);
		});

		it("should assemble the 65C02's", () => {
			const source = `
				stz $12
				lda ($12)
				bra *
				stp
			`;
			expect(assemble(source)).toEqual([0x64, 0x12, 0xb2, 0x12, 0x80, 0xfe, 0xdb]);
		});

		it("should take a signature byte on BRK, COP and WDM, with # or not, 0 when left out", () => {
			const source = `
				brk
				brk #$12
				cop $34
				cop #$34
				wdm #1
				wdm
			`;
			expect(assemble(source)).toEqual([0x00, 0x00, 0x00, 0x12, 0x02, 0x34, 0x02, 0x34, 0x42, 0x01, 0x42, 0x00]);
		});

		it("should refuse a signature that isn't a byte", () => {
			expect(() => assemble("cop #$100")).toThrow("COP: the signature 256 is out of range ($0..$FF).");
			expect(() => assemble("brk.b #1")).toThrow("'BRK.B': .B only applies to an address that can be zero page, absolute or long.");
		});

		it("should assemble the stack relative modes", () => {
			const source = `
				lda $12,s
				sta $34,S
				ora ($56,s),y
				sbc ($78,S),Y
			`;
			expect(assemble(source)).toEqual([0xa3, 0x12, 0x83, 0x34, 0x13, 0x56, 0xf3, 0x78]);
		});

		it("should assemble the indirect long modes", () => {
			const source = `
				lda [$12]
				adc [$34],y
				jml [$1234]
				jmp [$5678]
			`;
			expect(assemble(source)).toEqual([0xa7, 0x12, 0x77, 0x34, 0xdc, 0x34, 0x12, 0xdc, 0x78, 0x56]);
		});

		it("should assemble JML and JSL with a 24-bit address, JSR (abs,x), PEA and PEI", () => {
			const source = `
				jml $123456
				jsl $01FFFF
				jsr ($1234,x)
				pea $1234
				pea $12
				pei ($12)
			`;
			expect(assemble(source)).toEqual([
				0x5c, 0x56, 0x34, 0x12, 0x22, 0xff, 0xff, 0x01, 0xfc, 0x34, 0x12, 0xf4, 0x34, 0x12, 0xf4, 0x12, 0x00, 0xd4, 0x12,
			]);
		});

		it("should assemble MVN and MVP, the source bank then the destination, the bytes the other way", () => {
			const source = `
				mvn $01,$02
				mvp #$03,#$04
				SRC = $7E
				mvn SRC,$7F
			`;
			expect(assemble(source)).toEqual([0x54, 0x02, 0x01, 0x44, 0x04, 0x03, 0x54, 0x7f, 0x7e]);
		});

		it("should refuse MVN without two banks, or a bank that isn't a byte", () => {
			expect(() => assemble("mvn $01")).toThrow("MVN takes a source and a destination bank: 'MVN $01,$02'.");
			expect(() => assemble("mvn $01,$7E0000")).toThrow("MVN: the bank 8257536 is out of range ($0..$FF).");
		});

		it("should assemble BRL and PER with a 16-bit offset, forward and backward", () => {
			const source = `
				start:
				brl next
				per start
				next:
				brl start
			`;
			expect(assemble(source)).toEqual([0x82, 0x03, 0x00, 0x62, 0xfa, 0xff, 0x82, 0xf7, 0xff]);
		});

		it("should reach any target in the bank with BRL, wrapping, and none in another", () => {
			expect(assemble("brl $0000", 0xff00)).toEqual([0x82, 0xfd, 0x00]);
			expect(assemble("brl $01FF00", 0x010000)).toEqual([0x82, 0xfd, 0xfe]);
			expect(() => assemble("brl $020000", 0x01fff0)).toThrow(
				"Branch target $020000 is in another bank than the instruction at $01FFF0: a 16-bit offset stays in its bank.",
			);
		});

		it("should assemble REP and SEP that keep the widths 8 bits", () => {
			const source = `
				sep #$30
				rep #$CF
			`;
			expect(assemble(source)).toEqual([0xe2, 0x30, 0xc2, 0xcf]);
		});

		it("should refuse the modes no 65xx has", () => {
			expect(() => assemble("lda [$12],x")).toThrow("Invalid addressing mode for instruction LDA");
			expect(() => assemble("lda ($12,x),y")).toThrow("Invalid addressing mode for instruction LDA");
			expect(() => assemble("ldx $12,s")).toThrow("Invalid addressing mode for instruction LDX");
			expect(() => assemble("lda $100,s")).toThrow("LDA: the stack offset 256 is out of range ($0..$FF).");
		});
	});

	describe("its addresses: direct page, absolute and long", () => {
		it("should take the size of the value written", () => {
			const source = `
				lda $12
				lda $1234
				lda $123456
				lda $12,x
				lda $1234,x
				lda $123456,x
				sta $7E0000
			`;
			expect(assemble(source)).toEqual([
				0xa5, 0x12, 0xad, 0x34, 0x12, 0xaf, 0x56, 0x34, 0x12, 0xb5, 0x12, 0xbd, 0x34, 0x12, 0xbf, 0x56, 0x34, 0x12, 0x8f, 0x00, 0x00, 0x7e,
			]);
		});

		it("should refuse a long address on an instruction without a long form, or over 24 bits", () => {
			expect(() => assemble("ldx $123456")).toThrow("LDX has no long form, and $123456 is over $FFFF: ldx.w takes its low 16 bits, in the data bank.");
			expect(() => assemble("lda $123456,y")).toThrow(
				"LDA has no long,Y form, and $123456 is over $FFFF: lda.w takes its low 16 bits, in the data bank.",
			);
			expect(() => assemble("pea $123456")).toThrow("PEA has no long form, and $123456 is over $FFFF: pea.w takes its low 16 bits.");
			expect(() => assemble("lda $1000000")).toThrow("Address 16777216 is out of range ($0..$FFFFFF).");
			expect(() => assemble("jml $1000000")).toThrow("Address 16777216 is out of range ($0..$FFFFFF).");
		});

		it("should force direct page with .b and absolute with .w, keeping the low byte or 16 bits, and long with .l", () => {
			const source = `
				lda.b $1234
				lda.w $7E2000
				lda.w $12,x
				lda.l $12
				lda.l $1234,x
			`;
			expect(assemble(source)).toEqual([0xa5, 0x34, 0xad, 0x00, 0x20, 0xbd, 0x12, 0x00, 0xaf, 0x12, 0x00, 0x00, 0xbf, 0x34, 0x12, 0x00]);
		});

		it("should refuse .l on an instruction without a long form, or an operand that isn't an address", () => {
			expect(() => assemble("ldx.l $12")).toThrow("'LDX.L': LDX has no long form.");
			expect(() => assemble("lda.l $12,y")).toThrow("'LDA.L': LDA has no long,Y form.");
			expect(() => assemble("lda.l #$12")).toThrow("'LDA.L': .L only applies to an address that can be zero page, absolute or long.");
			expect(() => assemble("lda.l ($12),y")).toThrow("'LDA.L': .L only applies to an address that can be zero page, absolute or long.");
		});

		it("should keep JMP and JSR absolute, in the program bank, or long with .l", () => {
			const source = `
				jmp $8000
				jsr $9000
				jmp.l $1234
				jsr.l $123456
				jmp.w $123456
			`;
			expect(assemble(source)).toEqual([0x4c, 0x00, 0x80, 0x20, 0x00, 0x90, 0x5c, 0x34, 0x12, 0x00, 0x22, 0x56, 0x34, 0x12, 0x4c, 0x56, 0x34]);
			expect(assemble("jmp $018000", 0x018000)).toEqual([0x4c, 0x00, 0x80]);
		});

		it("should refuse JMP or JSR to another bank than the instruction's", () => {
			expect(() => assemble("jmp $123456")).toThrow(
				"JMP $123456 is in another bank than the instruction at $8000: jml reaches it, and jmp.w takes its low 16 bits, in the program bank.",
			);
			expect(() => assemble("jsr $1234", 0x018000)).toThrow(
				"JSR $1234 is in another bank than the instruction at $018000: jsl reaches it, and jsr.w takes its low 16 bits, in the program bank.",
			);
		});

		it("should refuse a branch to another bank", () => {
			expect(() => assemble("bne $010002", 0x00fffc)).toThrow(
				"Branch target $010002 is in another bank than the instruction at $FFFC: a branch stays in its bank.",
			);
		});

		it("should make a symbol defined later absolute, and refuse it in pass 2 if it needs long", () => {
			const later = (mnemonic: string, value: string) => `
				${mnemonic} far
				far = ${value}
			`;
			expect(assemble(later("lda", "$1234"))).toEqual([0xad, 0x34, 0x12]);
			expect(assemble(later("lda.l", "$123456"))).toEqual([0xaf, 0x56, 0x34, 0x12]);
			expect(() => assemble(later("lda", "$123456"))).toThrow(
				"LDA $123456 needs a long address, but pass 1 made it absolute: a symbol in it is defined after the LDA. Write lda.l, or define the symbol earlier.",
			);
		});

		it("should not take another instruction's pass-1 size, when the passes read other code", () => {
			const source = `
				.if FLAG
				lda far
				.end
				nop
				FLAG = 1
				far = $123456
			`;
			expect(assemble(source)).toEqual([0xaf, 0x56, 0x34, 0x12, 0xea]);
		});
	});

	describe("its mode, E", () => {
		const errorOf = (source: string) => {
			try {
				assemble(source);
			} catch (e) {
				return e as AsmError;
			}
			throw new Error("expected the assembly to fail");
		};

		it("should start in emulation mode, where a REP can't make a width 16-bit", () => {
			expect(() => assemble("rep #$30")).toThrow(EMULATION_REP);
		});

		it("should follow clc / xce to native mode, and sec / xce back to emulation", () => {
			const toNative = `
				clc
				xce
				sep #$30
			`;
			expect(assemble(toNative)).toEqual([0x18, 0xfb, 0xe2, 0x30]);
			expect(
				assemble(`
					${toNative}
					rep #$30
				`).slice(-2),
			).toEqual(REP_30);
			const back = `
				clc
				xce
				sec
				xce
				rep #$30
			`;
			expect(() => assemble(back)).toThrow(EMULATION_REP);
		});

		it("should be set by .native and .emulation", () => {
			const native = `
				.native
				rep #$30
			`;
			expect(assemble(native).slice(-2)).toEqual(REP_30);
			const emulation = `
				.native
				.emulation
				rep #$30
			`;
			expect(() => assemble(emulation)).toThrow(EMULATION_REP);
		});

		it.each([
			["nothing", ""],
			["another instruction", "nop"],
			["rep #$01, clearing the carry too", "rep #$01"],
			[
				"a label",
				`clc
				label:`,
			],
			[
				"a label without colon",
				`clc
				label`,
			],
			[
				"a local label",
				`start:
				clc
				:here`,
			],
			[
				"an anonymous label",
				`clc
				:`,
			],
			[
				"data",
				`clc
				.db 0`,
			],
			[
				"a PC move",
				`clc
				.org $9000`,
			],
		])("should make it unknown after an xce with %s before it, with a note at that xce", (_, before) => {
			const source = `
				.native
				${before}
				xce
				rep #$30
			`;
			const error = errorOf(source);
			const xceLine = source.split("\n").findIndex((line) => line.trim() === "xce") + 1;
			expect(error.message).toBe(UNKNOWN_REP);
			expect(error.location.line).toBe(xceLine + 1);
			expect(error.notes).toEqual([
				expect.objectContaining({ message: "the mode is unknown after this XCE", location: expect.objectContaining({ line: xceLine }) }),
			]);
		});

		it("should follow the idiom across a comment, a branch not taken or a macro", () => {
			const source = `
				.native
				sec ; comment
				.if 0
				nop
				.end
				xce
				rep #$30
			`;
			expect(() => assemble(source)).toThrow(EMULATION_REP);
			const macro = `
				.macro to_native
				clc
				xce
				.end
				to_native
				rep #$30
			`;
			expect(assemble(macro).slice(-2)).toEqual(REP_30);
		});

		it("should be known again after the idiom or a directive", () => {
			const idiom = `
				xce
				clc
				xce
				rep #$30
			`;
			expect(assemble(idiom).slice(-2)).toEqual(REP_30);
			const directive = `
				xce
				.emulation
				rep #$30
			`;
			expect(() => assemble(directive)).toThrow(EMULATION_REP);
		});

		it("should start each pass in emulation mode, the widths 8 bits", () => {
			const source = `
				lda #$12
				.native
				.a16
			`;
			expect(assemble(source)).toEqual([0xa9, 0x12]);
		});

		it("should be kept across .cpu switches", () => {
			const source = `
				.native
				.cpu 6502
				nop
				.cpu 65816
				rep #$30
			`;
			expect(assemble(source).slice(-2)).toEqual(REP_30);
		});

		it("should refuse an operand after .native or .emulation, and both under another CPU", () => {
			expect(() => assemble(".native foo")).toThrow("Unexpected 'foo' after '.native': it takes no operand.");
			expect(() => assemble(".EMULATION 1")).toThrow("Unexpected '1' after '.EMULATION': it takes no operand.");
			const other = `
				.cpu 65C02
				.native
			`;
			expect(() => assemble(other)).toThrow("'.native' is a 65816 directive: the current CPU is 65C02.");
		});
	});

	describe("its widths, M and X", () => {
		const errorOf = (source: string) => {
			try {
				assemble(source);
			} catch (e) {
				return e as AsmError;
			}
			throw new Error("expected the assembly to fail");
		};

		/** The pass 2 listing's instructions, after their address and bytes. */
		const listing = (source: string) => {
			const sink = new MemorySink();
			const assembler = new Assembler(new Cpu65816Handler(), new MockFileHandler(), {
				logger: new Logger({ sink, enabled: true }),
				segments: [{ name: "CODE", start: 0x8000, size: 0, resizable: true }],
				log: { pass2Enabled: true },
			});
			assembler.assemble(source);
			return sink.logs.filter((line) => /^[0-9A-F]{4}: [0-9A-F]{2} /.test(line)).map((line) => line.slice(50).trimEnd());
		};

		it("should start at 8 bits", () => {
			const source = `
				lda #$12
				ldx #$34
			`;
			expect(assemble(source)).toEqual([0xa9, 0x12, 0xa2, 0x34]);
		});

		it("should follow REP and SEP in native mode", () => {
			const source = `
				.native
				rep #$20
				lda #$1234
				ldx #$12
				rep #$10
				ldy #$1234
				sep #$20
				lda #$12
				sep #$30
				cpx #$12
			`;
			expect(assemble(source)).toEqual([
				0xc2, 0x20, 0xa9, 0x34, 0x12, 0xa2, 0x12, 0xc2, 0x10, 0xa0, 0x34, 0x12, 0xe2, 0x20, 0xa9, 0x12, 0xe2, 0x30, 0xe0, 0x12,
			]);
		});

		it("should be set by .a8, .a16, .i8 and .i16", () => {
			const source = `
				.native
				.a16
				lda #$1234
				.a8
				lda #$12
				.i16
				cpx #$1234
				.i8
				cpy #$12
			`;
			expect(assemble(source)).toEqual([0xa9, 0x34, 0x12, 0xa9, 0x12, 0xe0, 0x34, 0x12, 0xc0, 0x12]);
		});

		it.each([
			["LDA", 0xa9],
			["ADC", 0x69],
			["SBC", 0xe9],
			["AND", 0x29],
			["ORA", 0x09],
			["EOR", 0x49],
			["CMP", 0xc9],
			["BIT", 0x89],
		])("should take the accumulator's width for %s", (mnemonic, opcode) => {
			const source = `
				.native
				.a16
				${mnemonic} #$1234
				.i16
			`;
			expect(assemble(source)).toEqual([opcode, 0x34, 0x12]);
		});

		it.each([
			["LDX", 0xa2],
			["LDY", 0xa0],
			["CPX", 0xe0],
			["CPY", 0xc0],
		])("should take the index registers' width for %s", (mnemonic, opcode) => {
			const source = `
				.native
				.i16
				${mnemonic} #$1234
				.a16
			`;
			expect(assemble(source)).toEqual([opcode, 0x34, 0x12]);
		});

		it("should keep the other immediates one byte", () => {
			const source = `
				.native
				.a16
				.i16
				cop #$12
				sep #$00
			`;
			expect(assemble(source)).toEqual([0x02, 0x12, 0xe2, 0x00]);
		});

		it("should refuse a value that doesn't fit the width, never truncated", () => {
			const wide = `
				.native
				.a16
				lda #$10000
			`;
			expect(() => assemble(wide)).toThrow("Immediate value 65536 doesn't fit in 2 bytes (-32768..65535).");
			expect(() => assemble("lda #$100")).toThrow("Immediate value 256 doesn't fit in a byte (-128..255).");
			const negative = `
				.native
				.a16
				lda #-1
			`;
			expect(assemble(negative)).toEqual([0xa9, 0xff, 0xff]);
		});

		it("should force one immediate's width with .b or .w, the state unchanged", () => {
			const source = `
				lda.w #$12
				lda #$12
				.native
				.i16
				ldx.b #$12
				ldx #$12
			`;
			expect(assemble(source)).toEqual([0xa9, 0x12, 0x00, 0xa9, 0x12, 0xa2, 0x12, 0xa2, 0x12, 0x00]);
			expect(() => assemble("rep.w #$30")).toThrow("'REP.W': .W only applies to an address that can be zero page, absolute or long.");
			const c02 = `
				.cpu 65C02
				lda.w #$12
			`;
			expect(() => assemble(c02)).toThrow("'LDA.W': .W only applies to an address that can be zero page or absolute.");
		});

		it("should need REP's and SEP's operand known in pass 1", () => {
			const rep = `
				.native
				rep #FLAGS
				FLAGS = $30
			`;
			expect(() => assemble(rep)).toThrow("REP's operand must be known here: define its symbols before the REP, as the widths after it depend on it.");
			const sep = `
				sep #FLAGS
				FLAGS = $30
			`;
			expect(() => assemble(sep)).toThrow("SEP's operand must be known here: define its symbols before the SEP, as the widths after it depend on it.");
			const before = `
				FLAGS = $30
				.native
				rep #FLAGS
				lda #$1234
			`;
			expect(assemble(before)).toEqual([0xc2, 0x30, 0xa9, 0x34, 0x12]);
		});

		it.each([
			["PLP", "a PLP", 0x28],
			["RTI", "an RTI", 0x40],
		])("should make both unknown after %s in native mode, with a note at it", (mnemonic, named) => {
			const source = `
				.native
				${mnemonic}
				lda #1
			`;
			const error = errorOf(source);
			expect(error.message).toBe(`LDA's immediate needs the accumulator's width, unknown since ${named}: set it with .a8 / .a16, or sep / rep.`);
			expect(error.location.line).toBe(4);
			expect(error.notes).toEqual([
				expect.objectContaining({
					message: `the accumulator's width is unknown after this ${mnemonic}`,
					location: expect.objectContaining({ line: 3 }),
				}),
			]);
			const index = `
				.native
				${mnemonic}
				ldx #1
			`;
			expect(() => assemble(index)).toThrow(
				`LDX's immediate needs the index registers' width, unknown since ${named}: set it with .i8 / .i16, or sep / rep.`,
			);
		});

		it("should keep them 8 bits after PLP in emulation mode", () => {
			const source = `
				plp
				lda #$12
			`;
			expect(assemble(source)).toEqual([0x28, 0xa9, 0x12]);
		});

		it("should know a width again after a directive, or a SEP / REP covering its flag", () => {
			const sep = `
				.native
				plp
				sep #$20
				lda #$12
			`;
			expect(assemble(sep)).toEqual([0x28, 0xe2, 0x20, 0xa9, 0x12]);
			expect(() =>
				assemble(`
					${sep}
					ldx #$12
				`),
			).toThrow("LDX's immediate needs the index registers' width, unknown since a PLP");
			const directive = `
				.native
				plp
				.i16
				ldx #$1234
			`;
			expect(assemble(directive)).toEqual([0x28, 0xa2, 0x34, 0x12]);
		});

		it("should make them 8 bits with sec / xce or .emulation, and keep them with clc / xce", () => {
			const sec = `
				.native
				rep #$30
				sec
				xce
				lda #$12
				ldx #$12
			`;
			expect(assemble(sec).slice(-4)).toEqual([0xa9, 0x12, 0xa2, 0x12]);
			const emulation = `
				.native
				.a16
				.emulation
				lda #$12
			`;
			expect(assemble(emulation)).toEqual([0xa9, 0x12]);
			const clc = `
				.native
				.a16
				clc
				xce
				lda #$1234
			`;
			expect(assemble(clc)).toEqual([0x18, 0xfb, 0xa9, 0x34, 0x12]);
		});

		it("should make a width that isn't 8 unknown after an xce it can't follow, with a note at it", () => {
			const source = `
				.native
				.a16
				nop
				xce
				ldx #$12
				lda #1
			`;
			const error = errorOf(source);
			expect(error.message).toBe("LDA's immediate needs the accumulator's width, unknown since an XCE: set it with .a8 / .a16, or sep / rep.");
			expect(error.notes).toEqual([
				expect.objectContaining({ message: "the accumulator's width is unknown after this XCE", location: expect.objectContaining({ line: 5 }) }),
			]);
		});

		it("should refuse .a16 and .i16 in emulation mode, and while the mode is unknown", () => {
			expect(() => assemble(".a16")).toThrow(
				".a16 can't make the accumulator 16-bit in emulation mode: switch to native mode with clc / xce, or say the code runs in it with .native.",
			);
			const unknown = `
				xce
				.i16
			`;
			const error = errorOf(unknown);
			expect(error.message).toBe(
				".i16 needs the 65816's mode, unknown since an XCE without clc or sec right before it: set it with clc / xce, sec / xce, .native or .emulation.",
			);
			expect(error.notes).toEqual([expect.objectContaining({ message: "the mode is unknown after this XCE" })]);
		});

		it("should be kept across .cpu switches", () => {
			const source = `
				.native
				.a16
				.cpu 6502
				nop
				.cpu 65816
				lda #$1234
			`;
			expect(assemble(source)).toEqual([0xea, 0xa9, 0x34, 0x12]);
		});

		it("should list the width an immediate was assembled with", () => {
			const source = `
				lda #$12
				.native
				rep #$30
				lda #$1234
				ldx.b #$12
				sep #$30
			`;
			expect(listing(source)).toEqual(["LDA #$12 ; A8", "REP #$30", "LDA #$1234 ; A16", "LDX.B #$12 ; I8", "SEP #$30"]);
		});
	});

	describe("in a relocatable segment", () => {
		const relocatable = (source: string) =>
			newAssembler()
				.assemble(`
					.segment RCODE { reloc: true }
					.segment DATA { reloc: true }
					.segment DATA
					msg:
					.segment RCODE
					${source}
				`)
				.find((s) => s.name === "RCODE");

		it("should record the 3 bytes of a long address, and the 2 of [abs]", () => {
			expect(relocatable("jsl msg+1")).toMatchObject({
				data: [0x22, 0x01, 0x00, 0x00],
				relocs: [{ offset: 1, size: 3, shift: 0, segment: "DATA", targetOffset: 1 }],
			});
			expect(relocatable("jml [msg]")).toMatchObject({ data: [0xdc, 0x00, 0x00], relocs: [{ offset: 1, size: 2, segment: "DATA" }] });
		});

		it("should take a relocatable immediate with a 16-bit width, as .dw does", () => {
			const wide = (operand: string) => `
				.native
				.a16
				lda #${operand}
			`;
			expect(relocatable(wide("msg+2"))).toMatchObject({
				data: [0xa9, 0x02, 0x00],
				relocs: [{ offset: 1, size: 2, shift: 0, segment: "DATA", targetOffset: 2 }],
			});
			expect(relocatable(wide(">msg"))).toMatchObject({ data: [0xa9, 0x00, 0x00], relocs: [{ offset: 1, size: 1, shift: 8, segment: "DATA" }] });
			expect(() => relocatable("lda #msg")).toThrow("LDA #DATA+$0000: an immediate is one byte, take one of the relocatable address with <, > or ^.");
		});

		it("should make a relocatable address absolute in its own segment, never direct page", () => {
			expect(relocatable("start: lda start")).toMatchObject({ data: [0xad, 0x00, 0x00], relocs: [{ offset: 1, size: 2, segment: "RCODE" }] });
			expect(relocatable("start: jmp start")).toMatchObject({ data: [0x4c, 0x00, 0x00], relocs: [{ offset: 1, size: 2, segment: "RCODE" }] });
			expect(() => relocatable("start: lda.b start")).toThrow("'LDA.B' needs a zero page address here, and RCODE+$0000 is relocatable");
		});

		it("should make it long in another segment, or absolute with .w", () => {
			expect(relocatable("lda msg+1")).toMatchObject({
				data: [0xaf, 0x01, 0x00, 0x00],
				relocs: [{ offset: 1, size: 3, segment: "DATA", targetOffset: 1 }],
			});
			expect(relocatable("lda.w msg,x")).toMatchObject({ data: [0xbd, 0x00, 0x00], relocs: [{ offset: 1, size: 2, segment: "DATA" }] });
			expect(relocatable("start: lda.l start")).toMatchObject({ data: [0xaf, 0x00, 0x00, 0x00], relocs: [{ offset: 1, size: 3, segment: "RCODE" }] });
			expect(() => relocatable("ldx msg")).toThrow(
				"LDX has no long form, and DATA+$0000 is in another segment, whose bank is only known when it's loaded: ldx.w takes its low 16 bits, in the data bank.",
			);
		});

		it("should refuse JMP and JSR to another segment, its bank unknown", () => {
			expect(() => relocatable("jsr msg")).toThrow(
				"JSR can't reach DATA+$0000 with an absolute address, as segment 'DATA' is relocatable, its bank only known when it's loaded: jsl reaches it.",
			);
			expect(relocatable("jmp.w msg")).toMatchObject({ data: [0x4c, 0x00, 0x00], relocs: [{ offset: 1, size: 2, segment: "DATA" }] });
		});

		it("should keep JMP to a fixed address absolute, its low 16 bits", () => {
			expect(relocatable("jmp $123456")).toMatchObject({ data: [0x4c, 0x56, 0x34], relocs: [] });
		});

		it("should refuse a label of another segment defined later, which needs long", () => {
			expect(() =>
				relocatable(`
					lda later
					.segment DATA
					later:
				`),
			).toThrow(
				"LDA DATA+$0000 needs a long address, but pass 1 made it absolute: a symbol in it is defined after the LDA. Write lda.l, or define the symbol earlier.",
			);
		});

		it("should refuse a relocatable stack offset, bank or signature", () => {
			expect(() => relocatable("lda msg,s")).toThrow("LDA needs a stack offset here, and DATA+$0000 is relocatable");
			expect(() => relocatable("mvn ^msg,$01")).toThrow("MVN needs a bank here, and ^DATA+$0000 is relocatable");
			expect(() => relocatable("cop #<msg")).toThrow("COP needs a signature here, and <DATA+$0000 is relocatable");
		});
	});

	describe("on the 6502 and 65C02", () => {
		it.each(["lda $12,s", "lda ($12,s),y", "lda [$12]", "lda [$12],y", "jml $1234", "mvn $01,$02", "brl $8000"])("should refuse '%s'", (source) => {
			const run = (cpu: string) => () =>
				assemble(`
						.cpu ${cpu}
						${source}
					`);
			expect(run("65C02")).toThrow(/Invalid addressing mode|Unknown instruction|Syntax/);
			expect(run("6502")).toThrow(/Invalid addressing mode|Unknown instruction|Syntax/);
		});

		it("should keep a relocatable address of another segment absolute, and have no .l", () => {
			const source = `
				.cpu 6502
				.segment RCODE { reloc: true }
				.segment DATA { reloc: true }
				.segment DATA
				msg:
				.segment RCODE
				lda msg
				jmp msg
			`;
			expect(
				newAssembler()
					.assemble(source)
					.find((s) => s.name === "RCODE"),
			).toMatchObject({ data: [0xad, 0x00, 0x00, 0x4c, 0x00, 0x00] });
			expect(() =>
				assemble(`
					.cpu 65C02
					lda.l $12
				`),
			).toThrow("'LDA.L': the 65C02 has no '.L' suffix (it has .B, .W).");
		});

		it("should keep BRK one byte", () => {
			const source = `
				.cpu 65C02
				brk
			`;
			expect(assemble(source)).toEqual([0x00]);
		});
	});
});
