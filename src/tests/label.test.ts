import { describe, expect, it } from "vitest";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../logger.class";
import { Assembler } from "../polyasm";
import type { FileHandler, SegmentDefinition } from "../polyasm.types";

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("Label References", () => {
	const setup = () => {
		class MockFileHandler implements FileHandler {
			fullpath = "";
			readSourceFile(filename: string): string {
				throw new Error(`Mock file not found: "${filename}"`);
			}
			readBinaryFile(filename: string): number[] {
				throw new Error(`Mock bin file not found: ${filename}`);
			}
		}
		const logger = new Logger();
		const cpu6502 = new Cpu6502Handler();
		const assembler = new Assembler(cpu6502, new MockFileHandler(), { logger, segments: DEFAULT_SEGMENTS });
		const { symbolTable, expressionEvaluator: evaluator, lexer } = assembler;
		const tokenize = (expr: string) => lexer.tokenize(expr).filter((t) => t.type !== "EOF");
		return { assembler, symbolTable, evaluator, lexer, tokenize };
	};

	describe("Labels", () => {
		it("should define a label", () => {
			const { assembler } = setup();
			const source = `
			fwelcome	.cstr "WELCOME"
			`;
			assembler.assemble(source);
			const machineCode = assembler.link();
			expect(machineCode).toEqual([87, 69, 76, 67, 79, 77, 69, 0]);
			expect(assembler.symbolTable.lookupSymbol("fwelcome")).toBe(0x1000);
		});
	});

	describe("Nameless Local Labels", () => {
		it("should resolve a simple backward reference (:-)", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000, { line: 0, column: 0 });
			assembler.namelessLabels.add(0x1004, { line: 1, column: 0 });
			const tokens = tokenize(":-");
			const result = evaluator.evaluateAsNumber(tokens, {
				pc: 0x1008,
				assembler,
			});
			expect(result).toBe(0x1004);
		});

		it("should resolve a simple forward reference (:+)", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000, { line: 0, column: 0 });
			assembler.namelessLabels.add(0x1008, { line: 1, column: 0 });
			const tokens = tokenize(":+");
			const result = evaluator.evaluateAsNumber(tokens, {
				pc: 0x1002,
				assembler,
			});
			expect(result).toBe(0x1008);
		});

		it("should resolve a repeated backward reference (:--)", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000, { line: 0, column: 0 });
			assembler.namelessLabels.add(0x1004, { line: 1, column: 0 });
			assembler.namelessLabels.add(0x1008, { line: 2, column: 0 });
			const tokens = tokenize(":--");
			const result = evaluator.evaluateAsNumber(tokens, {
				pc: 0x100a,
				assembler,
			});
			expect(result).toBe(0x1004);
		});

		it("should resolve a numbered backward reference (:-2)", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000, { line: 0, column: 0 });
			assembler.namelessLabels.add(0x1004, { line: 1, column: 0 });
			assembler.namelessLabels.add(0x1008, { line: 2, column: 0 });
			const tokens = tokenize(":-2");
			const result = evaluator.evaluateAsNumber(tokens, {
				pc: 0x100a,
				assembler,
			});
			expect(result).toBe(0x1004);
		});

		it("should resolve a numbered forward reference (:+2)", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000, { line: 0, column: 0 });
			assembler.namelessLabels.add(0x1008, { line: 1, column: 0 });
			assembler.namelessLabels.add(0x1010, { line: 2, column: 0 });
			const tokens = tokenize(":+2");
			const result = evaluator.evaluateAsNumber(tokens, {
				pc: 0x1002,
				assembler,
			});
			expect(result).toBe(0x1010);
		});

		it("should throw an error for an unsatisfiable backward reference", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000, { line: 0, column: 0 });
			const tokens = tokenize(":-2");
			expect(() => evaluator.evaluateAsNumber(tokens, { pc: 0x1002, assembler })).toThrow("Not enough preceding anonymous labels to satisfy '-2' on line 1.");
		});

		it("should throw an error for an unsatisfiable forward reference", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1008, { line: 0, column: 0 });
			const tokens = tokenize(":+2");
			expect(() => evaluator.evaluateAsNumber(tokens, { pc: 0x1002, assembler })).toThrow("Not enough succeeding anonymous labels to satisfy '+2' on line 1.");
		});
	});

	describe("Named Local Labels", () => {
		it("should resolve a named local label within its scope", () => {
			const { assembler } = setup();
			const source = `
				.ORG $1000
				FillMemory:
					LDX #$00
				:loop
					STA $2000,X
					INX
					BNE :loop
					RTS
			`;
			assembler.assemble(source);
			const machineCode = assembler.link();
			expect(machineCode).toEqual([
				0xa2,
				0x00, // LDX #$00
				0x9d,
				0x00,
				0x20, // STA $2000,X
				0xe8, // INX
				0xd0,
				0xfa, // BNE :loop (to $1002)
				0x60, // RTS
			]);
		});

		it("should resolve named local labels with the same name in different scopes", () => {
			const { assembler } = setup();
			const source = `
				.ORG $1000
				Scope1:
					JMP :local
				:local
					NOP

				Scope2:
					JMP :local
				:local
					NOP
			`;
			assembler.assemble(source);
			const machineCode = assembler.link();
			expect(machineCode).toEqual([
				0x4c,
				0x03,
				0x10, // JMP $1003 (Scope1::local)
				0xea, // NOP
				0x4c,
				0x07,
				0x10, // JMP $1007 (Scope2::local)
				0xea, // NOP
			]);
		});
	});

	describe("Local Labels with different prefixes", () => {
		it("should resolve nameless label with a custom prefix from .OPTION", () => {
			const { assembler } = setup();
			const source = `
				.OPTION local_label_style ":"
				.ORG $1000
				: ; Anonymous label at $1000
				LDA :-
			`;
			assembler.assemble(source);
			const machineCode = assembler.link();
			expect(machineCode).toEqual([0xad, 0x00, 0x10]); // JMP $1000
		});

		it("should resolve label with a custom prefix from .OPTION", () => {
			const { assembler } = setup();
			const source = `
				.OPTION local_label_char ":"

				.ORG $1000
				start:

				:loop
				LDA :loop

				.OPTION local_label_char "!"
				secondstart:

				!loop
				LDA !loop
			`;
			assembler.assemble(source);
			const machineCode = assembler.link();
			expect(machineCode).toEqual([0xad, 0x00, 0x10, 0xad, 0x03, 0x10]);
		});

		it("should resolve label for PREAD - bug fix", () => {
			const { assembler } = setup();
			const source = `
				.OPTION local_label_char "!"

				lda  $C070		 		; TRIGGER PADDLES
				ldy  #$00 				; INIT COUNT
				nop         			; COMPENSATE FOR 1ST COUNT
				nop
		!		lda  $C064,x 			;  COUNT Y-REG EVERY
				bpl  !+  				; 12 uSec [actually 11]
				iny
				bne  !-       			;EXIT AT 255 MAX
				dey
		!		rts
			`;
			assembler.assemble(source);
			const machineCode = assembler.link();
			expect(machineCode).toEqual([0xad, 0x70, 0xc0, 0xa0, 0x00, 0xea, 0xea, 0xbd, 0x64, 0xc0, 0x10, 0x04, 0xc8, 0xd0, 0xf8, 0x88, 0x60]);
		});
	});
});
