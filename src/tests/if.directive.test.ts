import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Directive: .if/.else", () => {
	const createAssembler = () => {
		const mockFileHandler = new MockFileHandler();
		const cpu = new Cpu6502Handler();
		return new Assembler(cpu, mockFileHandler);
	};

	it("should assemble code inside a true .if block", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 1
            NOP
            .end
        `;
		const asm = createAssembler();
		asm.assemble(source);

		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0xea); // NOP
		}
	});

	it("should not assemble code inside a false .if block", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 0
            NOP
            .end
            LDA #$42
        `;
		const asm = createAssembler();
		asm.assemble(source);

		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0xa9); // LDA immediate
			expect(segments[0].data[offset + 1]).toBe(0x42);
		}
	});

	it("should assemble the .if block but not the .else block when condition is true", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 1
            NOP
            .else
            CLC
            .end
        `;
		const asm = createAssembler();
		asm.assemble(source);

		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0xea); // NOP
			expect(segments[0].data[offset]).not.toBe(0x18); // CLC
		}
	});

	it("should assemble the .else block but not the .if block when condition is false", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 0
            NOP
            .else
            CLC
            .end
        `;
		const asm = createAssembler();
		asm.assemble(source);

		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0x18); // CLC
			expect(segments[0].data[offset]).not.toBe(0xea); // NOP
		}
	});

	it("should handle nested .if directives correctly", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 1
              .if 0
                NOP       ; should not be assembled
              .else
                SEC       ; should be assembled
              .end
              CLC         ; should be assembled
            .end
        `;
		const asm = createAssembler();
		asm.assemble(source);

		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0x38); // SEC
			expect(segments[0].data[offset + 1]).toBe(0x18); // CLC
		}
	});

	it("should handle C-style blocks", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 1 {
                NOP  ; should be assembled
            } .else {
                SEC  ; should NOT be assembled
            }
            .if 0 {
                NOP ; should NOT be assembled
            } .else {
                CLC ; should be assembled
            }
        `;
		const asm = createAssembler();
		asm.assemble(source);

		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0xea); // NOP
			expect(segments[0].data[offset + 1]).toBe(0x18); // CLC
		}
	});

	it("should handle mixed C-style and asm-style blocks", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .if 1 {
				.if 0
					NOP ; should NOT be assembled
				.else
					CLC ; should be assembled
				.end
            } .else {
                SEC  ; should NOT be assembled
            }
        `;
		const asm = createAssembler();
		asm.assemble(source);

		const segments = asm.linker.segments;
		expect(segments[0]).toBeDefined();
		if (segments[0]) {
			const offset = 0x2000 - segments[0].start;
			expect(segments[0].data[offset]).toBe(0x18); // CLC
		}
	});

	it("should report an unknown character inside a false .if block", () => {
		const source = `
            .if 0
            LDA @value
            .end
        `;
		const asm = createAssembler();
		expect(() => asm.assemble(source)).toThrow(
			expect.objectContaining({
				message: "Unexpected character '@' (U+0040).",
				location: expect.objectContaining({ line: 3, column: 17 }),
			}),
		);
	});

	describe(".elseif", () => {
		const assemble = (source: string) => {
			const asm = createAssembler();
			asm.assemble(source);
			return asm.link();
		};

		it.each([
			[1, [0xea]],
			[2, [0x18]],
			[3, [0x38]],
			[4, [0x60]],
		])("should assemble the first true branch, with a = %d", (a, bytes) => {
			const source = `
				a = ${a}
				.if a == 1
				nop
				.elseif a == 2
				clc
				.elseif a >= 3 && a < 4
				sec
				.else
				rts
				.end
			`;
			expect(assemble(source)).toEqual(bytes);
		});

		it.each([
			[1, [0xea]],
			[2, [0x18]],
			[3, [0x60]],
		])("should assemble the first true branch with braces, with a = %d", (a, bytes) => {
			const source = `
				a = ${a}
				.if a == 1 {
				nop
				} .elseif a == 2 {
				clc
				} .else {
				rts
				}
			`;
			expect(assemble(source)).toEqual(bytes);
		});

		it("should assemble nothing when no branch is true and there's no .else", () => {
			const source = `
				.if 0
				nop
				.elseif 0
				clc
				.end
				rts
			`;
			expect(assemble(source)).toEqual([0x60]);
		});

		// TODO 1.39: it was skipped with the false branch, and the .else taken.
		it("should not be skipped with a false .if branch", () => {
			const source = `
				.if 0
				nop
				.elseif 1
				rts
				.else
				brk
				.end
			`;
			expect(assemble(source)).toEqual([0x60]);
		});

		it("should not evaluate a condition after a branch taken", () => {
			const source = `
				.if 1
				nop
				.elseif .undefinedFunction(1) == 2
				rts
				.end
			`;
			expect(assemble(source)).toEqual([0xea]);
		});

		it("should handle nested .if blocks in its branches", () => {
			const source = `
				.if 0
				nop
				.elseif 1
				.if 0
				clc
				.elseif 1
				sec
				.end
				rts
				.else
				brk
				.end
			`;
			expect(assemble(source)).toEqual([0x38, 0x60]);
		});

		it.each([
			[
				"without a condition",
				`
				.if 1
				nop
				.elseif
				rts
				.end
			`,
				"Missing expression.",
				4,
			],
			[
				"after the .else",
				`
				.if 1
				nop
				.else
				rts
				.elseif 1
				brk
				.end
			`,
				"Unexpected .ELSEIF: the .ELSE branch must be the last one.",
				6,
			],
			[
				"after the .else, with braces",
				`
				.if 1 {
				nop
				} .else {
				rts
				} .elseif 1 {
				brk
				}
			`,
				"Unexpected .ELSEIF: the .ELSE branch must be the last one.",
				6,
			],
			[
				"as a second .else",
				`
				.if 0
				nop
				.else
				rts
				.else
				brk
				.end
			`,
				"Unexpected .ELSE: the .ELSE branch must be the last one.",
				6,
			],
			["missing its .end", ".if 0\nnop\n.elseif 1\nrts", "Missing .END for the .ELSEIF block.", 3],
		])("should be an error %s", (_, source, message, line) => {
			expect(() => assemble(source)).toThrow(expect.objectContaining({ message, location: expect.objectContaining({ line }) }));
		});
	});

	describe("a branch not taken", () => {
		const assemble = (source: string) => {
			const asm = createAssembler();
			asm.assemble(source);
			return asm.link();
		};

		it.each([
			[
				"a false .if",
				`
				.if 0
				.foobar 1
				.end
			`,
				3,
			],
			[
				"a false .elseif",
				`
				.if 0
				.elseif 0
				.foobar 1
				.end
			`,
				4,
			],
			[
				"an .elseif after a branch taken",
				`
				.if 1
				.elseif 1
				.foobar 1
				.end
			`,
				4,
			],
			[
				"an .else after a branch taken",
				`
				.if 1
				.else
				.foobar 1
				.end
			`,
				4,
			],
			[
				"a false .if, after a label",
				`
				.if 0
				lbl: .foobar 1
				.end
			`,
				3,
			],
			[
				"a false .if, with braces",
				`
				.if 0 {
				.foobar 1
				}
			`,
				3,
			],
			[
				"a block in a false .if",
				`
				.if 0
				.repeat 2
				.foobar 1
				.end
				.end
			`,
				4,
			],
		])("should reject an unknown directive in %s", (_, source, line) => {
			expect(() => assemble(source)).toThrow(
				expect.objectContaining({ message: "Syntax error - Unexpected directive 'FOOBAR'", location: expect.objectContaining({ line }) }),
			);
		});

		it("should accept the directives, system variables and functions it holds", () => {
			const source = `
				.if 0
				lbl: .db .pc, .len("ab")
				.repeat 2
				.dw .pc
				.end
				.if 1
				.elseif 0
				.else
				.end
				.macro m
				.end
				.hex
				01 02
				.end
				.end
				rts
			`;
			expect(assemble(source)).toEqual([0x60]);
		});
	});
});
