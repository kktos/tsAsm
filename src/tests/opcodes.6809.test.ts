import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6809Handler } from "../cpu/cpu6809.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Assembler - 6809 Opcodes", () => {
	it("should assemble basic 6809 instructions", () => {
		const fileHandler = new MockFileHandler();
		const assembler = new Assembler(new Cpu6809Handler(), fileHandler);

		const source = `
            .org $1000
            LDA #$10      ; Immediate
            LDB $20       ; Direct
            STA $1234     ; Extended
            NEGA          ; Inherent
            NOP           ; Inherent
        `;

		const segments = assembler.assemble(source);
		const code = assembler.link(segments);

		const expectedBytes = [
			// LDA #$10
			0x86, 0x10,
			// LDB $20
			0xd6, 0x20,
			// STA $1234
			0xb7, 0x12, 0x34,
			// NEGA
			0x40,
			// NOP
			0x12,
		];

		expect(code.slice(0, expectedBytes.length)).toEqual(expectedBytes);
	});

	it("should assemble relative branches", () => {
		const fileHandler = new MockFileHandler();
		const assembler = new Assembler(new Cpu6809Handler(), fileHandler);

		const source = `
            .org $1000
            BRA loop_back
            NOP
        loop_back:
            BRA loop_forward
            NOP
        loop_forward:
        `;

		const segments = assembler.assemble(source);
		const code = assembler.link(segments);

		const expectedBytes = [
			// BRA loop_back ($1000 -> $1003)
			0x20,
			0x01, // Offset = $1003 - ($1000 + 2) = 1
			// NOP
			0x12,
			// loop_back: ($1003)
			// BRA loop_forward ($1003 -> $1006)
			0x20,
			0x01, // Offset = $1006 - ($1003 + 2) = 1
			// NOP
			0x12,
			// loop_forward: ($1006)
		];

		expect(code.slice(0, expectedBytes.length)).toEqual(expectedBytes);
	});

	it("should assemble a more complex example", () => {
		const fileHandler = new MockFileHandler();
		const assembler = new Assembler(new Cpu6809Handler(), fileHandler, { log: { pass1Enabled: true, pass2Enabled: true } });

		const source = `
			.SEGMENT CODE { start: 0x4000, size: 0x1000 }
			;.org $4000
			.SEGMENT CODE

			start:
				leay helloworld,pcr
				jsr print
				rts

			textscreenbase = $0400

			print:
				pshs a,x,y
				ldx #textscreenbase
			printloop:
				lda ,y+
				beq printover
				cmpa #$40
				bhs print6847
				adda #$40
			print6847:
				sta ,x+
				bra printloop
			printover:
				puls a,x,y
				rts


			helloworld:
				.db "HELLO WORLD",0
        `;

		const segments = assembler.assemble(source);
		const code = assembler.link(segments);

		const expectedBytes = [
			0x31,
			0x8d,
			0x00,
			0x1a, //	LEAY $401E,PCR
			0xbd,
			0x40,
			0x08, //	JSR PRINT
			0x39, // RTS
			0x34,
			0x32, // PSHS A,X,Y
			0x8e,
			0x04,
			0x00, // LDX #$0400
			0xa6,
			0xa0, // LDA ,Y+
			0x27,
			0x0a, // BEQ PRINTOVER
			0x81,
			0x40, // CMPA #$40
			0x24,
			0x02, // BCC PRINT6847
			0x8b,
			0x40, // ADDA #$40
			0xa7,
			0x80, // STA ,X+
			0x20,
			0xf2, // BRA PRINTLOOP
			0x35,
			0x32, // PULS A,X,Y
			0x39, // RTS
			0x48,
			0x45,
			0x4c,
			0x4c,
			0x4f,
			0x20,
			0x57,
			0x4f,
			0x52,
			0x4c,
			0x44,
			0x00,
		];

		expect(code.slice(0, expectedBytes.length)).toEqual(expectedBytes);
	});
});
