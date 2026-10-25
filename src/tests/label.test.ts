import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("Label References", () => {
	const setup = () => {
		const cpu6502 = new Cpu6502Handler();
		const assembler = new Assembler(cpu6502, new MockFileHandler(), { segments: DEFAULT_SEGMENTS });
		const { symbolTable, expressionEvaluator: evaluator } = assembler;
		const lexer = assembler.parser.lexer;
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
			assembler.namelessLabels.add(0x1000);
			assembler.namelessLabels.add(0x1004);
			const tokens = tokenize(":-");
			const result = evaluator.evaluateAsNumber(tokens, {
				PC: { value: 0x1008 },
			});
			expect(result).toBe(0x1004);
		});

		it("should resolve a simple forward reference (:+)", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000);
			assembler.namelessLabels.add(0x1008);
			const tokens = tokenize(":+");
			const result = evaluator.evaluateAsNumber(tokens, {
				PC: { value: 0x1002 },
			});
			expect(result).toBe(0x1008);
		});

		it("should resolve a repeated backward reference (:--)", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000);
			assembler.namelessLabels.add(0x1004);
			assembler.namelessLabels.add(0x1008);
			const tokens = tokenize(":--");
			const result = evaluator.evaluateAsNumber(tokens, {
				PC: { value: 0x100a },
			});
			expect(result).toBe(0x1004);
		});

		it("should resolve a numbered backward reference (:-2)", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000);
			assembler.namelessLabels.add(0x1004);
			assembler.namelessLabels.add(0x1008);
			const tokens = tokenize(":-2");
			const result = evaluator.evaluateAsNumber(tokens, {
				PC: { value: 0x100a },
			});
			expect(result).toBe(0x1004);
		});

		it("should resolve a numbered forward reference (:+2)", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000);
			assembler.namelessLabels.add(0x1008);
			assembler.namelessLabels.add(0x1010);
			const tokens = tokenize(":+2");
			const result = evaluator.evaluateAsNumber(tokens, {
				PC: { value: 0x1002 },
			});
			expect(result).toBe(0x1010);
		});

		it("should throw an error for an unsatisfiable backward reference", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1000);
			const tokens = tokenize(":-2");
			expect(() => evaluator.evaluateAsNumber(tokens, { PC: { value: 0x1002 } })).toThrow("Not enough preceding anonymous labels to satisfy '-2'.");
		});

		it("should throw an error for an unsatisfiable forward reference", () => {
			const { evaluator, tokenize, assembler } = setup();
			assembler.namelessLabels.add(0x1008);
			const tokens = tokenize(":+2");
			expect(() => evaluator.evaluateAsNumber(tokens, { PC: { value: 0x1002 } })).toThrow("Not enough succeeding anonymous labels to satisfy '+2'.");
		});

		const assembleBytes = (source: string) => {
			const { assembler } = setup();
			assembler.assemble(source);
			return assembler.link();
		};

		it("should not resolve :+ to a label on the same line", () => {
			// bne :+ targets the second ':', not the one on its own line
			expect(assembleBytes(": bne :+\n nop\n: rts")).toEqual([0xd0, 0x01, 0xea, 0x60]);
		});

		it("should give each .repeat iteration its own anonymous labels", () => {
			expect(assembleBytes(".repeat 2\n bne :+\n nop\n: nop\n.end")).toEqual([0xd0, 0x01, 0xea, 0xea, 0xd0, 0x01, 0xea, 0xea]);
		});

		it("should throw when an anonymous label moves between the passes", () => {
			const { assembler } = setup();
			// reported at the anonymous label, on line 4
			expect(() => assembler.assemble(" lda zp\n bne :+\n nop\n: rts\nzp = $10")).toThrow(
				expect.objectContaining({
					message: expect.stringContaining("Phase error: anonymous label is $1006 in pass 1 but $1005 in pass 2"),
					location: expect.objectContaining({ line: 4, column: 1 }),
				}),
			);
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

	describe("Local labels in macros", () => {
		it("should resolve a local label in a macro expanded twice", () => {
			const { assembler } = setup();
			const source = `
			.macro wait
			delay:
			:loop
				dex
				bne :loop
			.end
				wait
				wait
			`;
			assembler.assemble(source);
			expect(assembler.link()).toEqual([0xca, 0xd0, 0xfd, 0xca, 0xd0, 0xfd]);
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
				.OPTION local.prefix ":"

				.ORG $1000
				start:

				:loop
				LDA :loop

				.OPTION local.prefix "!"
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
				.OPTION anon.marker "!"

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

	describe("Phase errors", () => {
		it("should throw when a label moves between the passes", () => {
			const { assembler } = setup();
			// pass 1 sizes 'lda zp' as absolute (zp unknown yet), pass 2 as zero page: lbl moves from $1006 to $1005
			const source = `
				lda zp
				jmp lbl
			lbl:
				rts
			zp = $10
			`;
			expect(() => assembler.assemble(source)).toThrow("Phase error: label 'LBL' is $1006 in pass 1 but $1005 in pass 2");
		});

		it("should throw when a local label moves between the passes", () => {
			const { assembler } = setup();
			const source = `
			main:
				lda zp
				jmp :done
			:done
				rts
			zp = $10
			`;
			expect(() => assembler.assemble(source)).toThrow("Phase error: local label ':done' of 'MAIN' is $1006 in pass 1 but $1005 in pass 2");
		});

		it("should assemble when the symbol is defined before its use", () => {
			const { assembler } = setup();
			const source = `
			zp = $10
				lda zp
				jmp lbl
			lbl:
				rts
			`;
			assembler.assemble(source);
			expect(assembler.link()).toEqual([0xa5, 0x10, 0x4c, 0x05, 0x10, 0x60]);
		});
	});
});
