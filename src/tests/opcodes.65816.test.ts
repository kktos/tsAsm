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

const NATIVE_REP = "REP #$30 makes the accumulator and the index registers 16-bit: the 65816's widths stay 8 bits for now.";
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
			expect(() => assemble("brk.b #1")).toThrow("'BRK.B': .B only applies to an address that can be zero page or absolute.");
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

		it("should refuse a REP making the accumulator or the index registers 16-bit in native mode, also known in pass 2 only", () => {
			const rep = (operand: string) => `
				.native
				rep ${operand}
				FLAGS = $30
			`;
			expect(() => assemble(rep("#$20"))).toThrow("REP #$20 makes the accumulator 16-bit: the 65816's widths stay 8 bits for now.");
			expect(() => assemble(rep("#$10"))).toThrow("REP #$10 makes the index registers 16-bit: the 65816's widths stay 8 bits for now.");
			expect(() => assemble(rep("#FLAGS"))).toThrow(NATIVE_REP);
		});

		it("should refuse an address over $FFFF on an instruction with a short form, until long addressing is chosen", () => {
			expect(() => assemble("lda $123456")).toThrow("Address 1193046 is out of range ($0..$FFFF).");
			expect(() => assemble("jmp $123456")).toThrow("Address 1193046 is out of range ($0..$FFFF).");
			expect(() => assemble("jml $1000000")).toThrow("Address 16777216 is out of range ($0..$FFFFFF).");
		});

		it("should refuse the modes no 65xx has", () => {
			expect(() => assemble("lda [$12],x")).toThrow("Invalid addressing mode for instruction LDA");
			expect(() => assemble("lda ($12,x),y")).toThrow("Invalid addressing mode for instruction LDA");
			expect(() => assemble("ldx $12,s")).toThrow("Invalid addressing mode for instruction LDX");
			expect(() => assemble("lda $100,s")).toThrow("LDA: the stack offset 256 is out of range ($0..$FF).");
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
			expect(() =>
				assemble(`
					${toNative}
					rep #$30
				`),
			).toThrow(NATIVE_REP);
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
			expect(() => assemble(native)).toThrow(NATIVE_REP);
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
			expect(() => assemble(macro)).toThrow(NATIVE_REP);
		});

		it("should be known again after the idiom or a directive", () => {
			const idiom = `
				xce
				clc
				xce
				rep #$30
			`;
			expect(() => assemble(idiom)).toThrow(NATIVE_REP);
			const directive = `
				xce
				.emulation
				rep #$30
			`;
			expect(() => assemble(directive)).toThrow(EMULATION_REP);
		});

		it("should start each pass in emulation mode, and follow it in pass 2 as in pass 1", () => {
			const reset = `
				rep #FLAGS
				FLAGS = $30
				.native
			`;
			expect(() => assemble(reset)).toThrow(EMULATION_REP);
			const unknown = `
				xce
				rep #FLAGS
				FLAGS = $30
			`;
			expect(() => assemble(unknown)).toThrow(UNKNOWN_REP);
		});

		it("should be kept across .cpu switches", () => {
			const source = `
				.native
				.cpu 6502
				nop
				.cpu 65816
				rep #$30
			`;
			expect(() => assemble(source)).toThrow(NATIVE_REP);
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

		it("should keep BRK one byte", () => {
			const source = `
				.cpu 65C02
				brk
			`;
			expect(assemble(source)).toEqual([0x00]);
		});
	});
});
