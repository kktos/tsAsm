import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6809Handler } from "../cpu/cpu6809.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Assembler - 6809 All Opcodes", () => {
	const fileHandler = new MockFileHandler();
	let assembler: Assembler;

	function assembleAndLink(source: string): number[] {
		assembler = new Assembler(new Cpu6809Handler(), fileHandler, { log: { pass1Enabled: true, pass2Enabled: true } });
		const segments = assembler.assemble(source);
		return assembler.link(segments);
	}

	describe("8-bit arithmetic instructions", () => {
		it("should assemble ADDA and ADDB", () => {
			let code = assembleAndLink("ADDA #$12");
			expect(code).toEqual([0x8b, 0x12]);
			code = assembleAndLink("ADDB #$12");
			expect(code).toEqual([0xcb, 0x12]);
		});

		it("should assemble SUBA and SUBB", () => {
			let code = assembleAndLink("SUBA #$12");
			expect(code).toEqual([0x80, 0x12]);
			code = assembleAndLink("SUBB #$12");
			expect(code).toEqual([0xc0, 0x12]);
		});
	});

	describe("16-bit arithmetic instructions", () => {
		it("should assemble ADDD", () => {
			const code = assembleAndLink("ADDD #$1234");
			expect(code).toEqual([0xc3, 0x12, 0x34]);
		});
	});

	describe("Branch instructions", () => {
		it("should assemble BRA", () => {
			const code = assembleAndLink("BRA label\nlabel:");
			expect(code).toEqual([0x20, 0x00]);
		});
		it("should assemble BSR", () => {
			const code = assembleAndLink("BSR label\nlabel:");
			expect(code).toEqual([0x8d, 0x00]);
		});
	});

	describe("Load and store instructions", () => {
		it("should assemble LDA", () => {
			let code = assembleAndLink("LDA #$12");
			expect(code).toEqual([0x86, 0x12]);
			code = assembleAndLink("LDA $12");
			expect(code).toEqual([0x96, 0x12]);
			code = assembleAndLink("LDA $1234");
			expect(code).toEqual([0xb6, 0x12, 0x34]);
			code = assembleAndLink("LDA ,X");
			expect(code).toEqual([0xa6, 0x84]);
		});
		it("should assemble LDB", () => {
			let code = assembleAndLink("LDB #$12");
			expect(code).toEqual([0xc6, 0x12]);
			code = assembleAndLink("LDB $12");
			expect(code).toEqual([0xd6, 0x12]);
			code = assembleAndLink("LDB $1234");
			expect(code).toEqual([0xf6, 0x12, 0x34]);
			code = assembleAndLink("LDB ,X");
			expect(code).toEqual([0xe6, 0x84]);
		});
		it("should assemble STA", () => {
			let code = assembleAndLink("STA $12");
			expect(code).toEqual([0x97, 0x12]);
			code = assembleAndLink("STA $1234");
			expect(code).toEqual([0xb7, 0x12, 0x34]);
			code = assembleAndLink("STA ,X");
			expect(code).toEqual([0xa7, 0x84]);
		});
		it("should assemble LDD", () => {
			const code = assembleAndLink("LDD #$1234");
			expect(code).toEqual([0xcc, 0x12, 0x34]);
		});
		it("should assemble LDX", () => {
			const code = assembleAndLink("LDX #$1234");
			expect(code).toEqual([0x8e, 0x12, 0x34]);
		});
		it("should assemble LDY", () => {
			const code = assembleAndLink("LDY #$1234");
			expect(code).toEqual([0x10, 0x8e, 0x12, 0x34]);
		});
		it("should assemble LDU", () => {
			const code = assembleAndLink("LDU #$1234");
			expect(code).toEqual([0xce, 0x12, 0x34]);
		});
	});

	describe("Indexed addressing modes", () => {
		it("should assemble auto-increment/decrement", () => {
			let code = assembleAndLink("LDA ,X+");
			expect(code).toEqual([0xa6, 0x80]);
			code = assembleAndLink("LDA ,X++");
			expect(code).toEqual([0xa6, 0x81]);
			code = assembleAndLink("LDA ,-X");
			expect(code).toEqual([0xa6, 0x82]);
			code = assembleAndLink("LDA ,--X");
			expect(code).toEqual([0xa6, 0x83]);
		});

		it("should assemble zero-offset and accumulator-offset", () => {
			let code = assembleAndLink("LDA ,X");
			expect(code).toEqual([0xa6, 0x84]);
			code = assembleAndLink("LDA B,X");
			expect(code).toEqual([0xa6, 0x85]);
			code = assembleAndLink("LDA A,X");
			expect(code).toEqual([0xa6, 0x86]);
		});

		it("should assemble constant-offset", () => {
			let code = assembleAndLink("LDA 4,X");
			expect(code).toEqual([0xa6, 0x04]);
			code = assembleAndLink("LDA 16,X");
			expect(code).toEqual([0xa6, 0x88, 0x10]);
			code = assembleAndLink("LDA 256,X");
			expect(code).toEqual([0xa6, 0x89, 0x01, 0x00]);
		});
	});
});
