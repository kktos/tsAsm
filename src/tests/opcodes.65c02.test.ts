import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("65C02 Opcodes", () => {
	const assembleAndGetCode = (source: string): number[] => {
		const cpu = new Cpu65C02Handler();
		const assembler = new Assembler(cpu, new MockFileHandler(), {
			segments: [{ name: "CODE", start: 0x8000, size: 0, resizable: true }],
		});
		const segments = assembler.assemble(source);
		const codeSegment = segments.find((s) => s.name === "CODE");
		return codeSegment?.data ?? [];
	};

	it("should assemble new implied instructions (PHX, PLX, PHY, PLY)", () => {
		const source = `
            PHX
            PLX
            PHY
            PLY
        `;
		const data = assembleAndGetCode(source);
		expect(data).toEqual([0xda, 0xfa, 0x5a, 0x7a]);
	});

	it("should assemble new accumulator instructions (INC A, DEC A)", () => {
		const source = `
            INC A
            DEC A
        `;
		const data = assembleAndGetCode(source);
		expect(data).toEqual([0x1a, 0x3a]);
	});

	it("should assemble STZ (Store Zero) instructions", () => {
		const source = `
            STZ $44
            STZ $55,X
            STZ $1234
            STZ $5678,X
        `;
		const data = assembleAndGetCode(source);
		expect(data).toEqual([
			0x64,
			0x44, // ZEROPAGE
			0x74,
			0x55, // ZEROPAGE_X
			0x9c,
			0x34,
			0x12, // ABSOLUTE
			0x9e,
			0x78,
			0x56, // ABSOLUTE_X
		]);
	});

	it("should assemble BRA (Branch Always) instruction", () => {
		const source = `
            BRA THERE
            NOP
        THERE:
            BRA START
        START:
        `;
		const data = assembleAndGetCode(source);
		expect(data).toEqual([0x80, 0x01, 0xea, 0x80, 0x00]);
		// BRA THERE: PC=0x8000, next=0x8002. THERE is at 0x8003. Offset = 0x8003 - 0x8002 = 1
		// BRA START: PC=0x8003, next=0x8005. START is at 0x8005. Offset = 0x8005 - 0x8005 = 0
		// The second BRA is to 0x8005, from PC 0x8003. Next is 0x8005. Offset is 0.
		// The first BRA is to 0x8003, from PC 0x8000. Next is 0x8002. Offset is 1.

		const source2 = `
        START:
            BRA START
        `;
		const data2 = assembleAndGetCode(source2);
		// BRA START: PC=0x8000, next=0x8002. START is at 0x8000. Offset = 0x8000 - 0x8002 = -2 (0xFE)
		expect(data2).toEqual([0x80, 0xfe]);
	});

	it("should assemble new Zero Page Indirect addressing mode (zp)", () => {
		const source = `
            LDA ($44)
            STA ($55)
            ADC ($66)
        `;
		const data = assembleAndGetCode(source);
		expect(data).toEqual([0xb2, 0x44, 0x92, 0x55, 0x72, 0x66]);
	});

	it("should assemble Zero Page Indirect Indexed X addressing mode (zp,X)", () => {
		const source = `
            ADC ($66,x)
        `;
		const data = assembleAndGetCode(source);
		expect(data).toEqual([0x61, 0x66]);
	});

	it("should assemble new Absolute Indirect Indexed X addressing mode for JMP", () => {
		const source = "JMP ($1234,X)";
		const data = assembleAndGetCode(source);
		expect(data).toEqual([0x7c, 0x34, 0x12]);
	});

	it("should assemble TSB and TRB instructions", () => {
		const source = `
            TSB $44
            TSB $1234
            TRB $55
            TRB $5678
        `;
		const data = assembleAndGetCode(source);
		expect(data).toEqual([0x04, 0x44, 0x0c, 0x34, 0x12, 0x14, 0x55, 0x1c, 0x78, 0x56]);
	});

	it("should raise an error for invalid addressing modes: CMP", () => {
		const source = `
        	cmp ($02),x
        `;
		expect(() => assembleAndGetCode(source)).toThrow(/Invalid addressing mode for instruction CMP/);
	});

	it("should raise an error for invalid addressing modes: JSR", () => {
		const source = `
        	jsr ($02)
        `;
		expect(() => assembleAndGetCode(source)).toThrow(/Invalid addressing mode for instruction JSR/);
	});
	it("should raise an error for invalid addressing modes: STA Immediate", () => {
		expect(() => assembleAndGetCode("STA #$00")).toThrow(/Invalid addressing mode for instruction STA/);
	});

	it("should raise an error for invalid addressing modes: LDA Implied (no operand)", () => {
		expect(() => assembleAndGetCode("LDA")).toThrow(/Invalid addressing mode for instruction LDA/);
	});

	it("should raise an error for invalid addressing modes: STX Indirect Y", () => {
		expect(() => assembleAndGetCode("STX ($10),Y")).toThrow(/Invalid addressing mode for instruction STX/);
	});

	it("should raise an error for invalid addressing modes: BIT Indirect X", () => {
		expect(() => assembleAndGetCode("BIT ($10,X)")).toThrow(/Invalid addressing mode for instruction BIT/);
	});

	it("should raise an error for invalid addressing modes: INC Zero Page Indirect", () => {
		expect(() => assembleAndGetCode("INC ($10)")).toThrow(/Invalid addressing mode for instruction INC/);
	});

	it("should raise an error for invalid addressing modes: JMP Absolute X", () => {
		expect(() => assembleAndGetCode("JMP $1234,X")).toThrow(/Invalid addressing mode for instruction JMP/);
	});

	it("should have pass 1 defaulting to Absolute Indexed Mode", () => {
		const source = `
        	lda data,x
			rts

			data:

        `;
		const data = assembleAndGetCode(source);
		expect(data).toEqual([0xbd, 0x04, 0x80, 0x60]);
	});

	it("should handle accumulator mode with or without A", () => {
		const source = `
			rts
        	asl
			asl a
			lsr
			lsr a
			inc
			inc a
			inc $02
			dec
			dec a
			rol
			rol a
			ror
			ror a
        `;
		const data = assembleAndGetCode(source);
		expect(data).toEqual([0x60, 0x0a, 0x0a, 0x4a, 0x4a, 0x1a, 0x1a, 0xe6, 0x02, 0x3a, 0x3a, 0x2a, 0x2a, 0x6a, 0x6a]);
	});

	it("should accept 1 char string as 8-bit value", () => {
		const source = `
			lda #"A"
			lda #'A'
        `;
		const data = assembleAndGetCode(source);
		expect(data).toEqual([0xa9, 0x41, 0xa9, 0x41]);
	});

	describe("operand ranges", () => {
		it("should accept operands at the limits, and < > on any 16-bit value", () => {
			const source = `
				LDA #255
				LDA #-128
				LDA #<$1232
				LDA #>$1232
				LDA $FFFF
				LDA ($FF),Y
			`;
			expect(assembleAndGetCode(source)).toEqual([0xa9, 0xff, 0xa9, 0x80, 0xa9, 0x32, 0xa9, 0x12, 0xad, 0xff, 0xff, 0xb1, 0xff]);
		});

		it.each([
			["LDA #256", "Immediate value 256 doesn't fit in a byte (-128..255)."],
			["LDA #$80+$80", "Immediate value 256 doesn't fit in a byte (-128..255)."],
			["LDA #big\nbig = $1234", "Immediate value 4660 doesn't fit in a byte (-128..255)."],
			["LDA $10000", "Address 65536 is out of range ($0..$FFFF)."],
			["LDA $12345,X", "Address 74565 is out of range ($0..$FFFF)."],
			["JMP ($10000)", "Address 65536 is out of range ($0..$FFFF)."],
			["LDA ($1234),Y", "Zero page address 4660 is out of range ($0..$FF)."],
		])("should throw on an out-of-range operand: %s", (source, message) => {
			expect(() => assembleAndGetCode(source)).toThrow(message);
		});
	});

	// In pass 1, an operand using a symbol defined later has no value yet: its size is the worst case.
	describe("operands defined later", () => {
		it.each([
			["LDA later\nlater = $1234", [0xad, 0x34, 0x12]],
			["LDA later,X\nlater = $1234", [0xbd, 0x34, 0x12]],
			["LDA (zp),Y\nzp = $10", [0xb1, 0x10]],
			["LDA #value\nvalue = 5", [0xa9, 0x05]],
			["JMP (vector)\nvector = $FFFC", [0x6c, 0xfc, 0xff]],
			["BNE done\nNOP\ndone: RTS", [0xd0, 0x01, 0xea, 0x60]],
		])("should assemble %j", (source, bytes) => {
			expect(assembleAndGetCode(source)).toEqual(bytes);
		});

		it("should report a zero page address defined later when code after it moves", () => {
			expect(() => assembleAndGetCode("LDA zp\nnext: NOP\nzp = $10")).toThrow("Phase error: label 'NEXT' is $8003 in pass 1 but $8002 in pass 2.");
		});
	});
});
