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
});
