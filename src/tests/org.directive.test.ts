import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("Directive: .ORG / *", () => {
	const createAssembler = (segments: SegmentDefinition[] = DEFAULT_SEGMENTS) => {
		const mockFileHandler = new MockFileHandler();
		const cpu = new Cpu6502Handler();
		return new Assembler(cpu, mockFileHandler, { segments });
	};

	describe(".ORG", () => {
		it("should set the program counter to a new address", () => {
			const source = `
            .cpu "6502"
            .org $2000
            LDA #$10
        `;
			const asm = createAssembler();
			const segments = asm.assemble(source);

			expect(segments.length).toBe(1);
			expect(segments[0]).toBeDefined();
			if (segments[0]) {
				expect(segments[0].name).toBe("CODE");
				expect(segments[0].start).toBe(0x1000);
				const offset = 0x2000 - segments[0]?.start;
				expect(segments[0].data[offset]).toBe(0xa9); // LDA immediate
				expect(segments[0].data[offset + 1]).toBe(0x10);
			}
		});

		it("should handle multiple .org directives", () => {
			const source = `
            .cpu "6502"
            .org $2000
            NOP
            .org $2010
            NOP
        `;
			const asm = createAssembler();
			const segments = asm.assemble(source);
			expect(segments[0]).toBeDefined();
			if (segments[0]) {
				const offset1 = 0x2000 - segments[0].start;
				expect(segments[0].data[offset1]).toBe(0xea); // NOP

				const offset2 = 0x2010 - segments[0].start;
				expect(segments[0].data[offset2]).toBe(0xea); // NOP
			}
		});

		it("should fail if out of current segment boundaries", () => {
			const source = `
            .cpu "6502"
            .org $300
            NOP
        `;
			const asm = createAssembler();
			expect(() => asm.assemble(source)).toThrow(/Write out of bounds: address \$300 is below segment 'CODE' start \$1000./);
		});

		it("should refuse a symbol defined after it, at the .org", () => {
			const error = (line: number) =>
				expect.objectContaining({
					message: "The .org address uses a symbol defined after it: define the symbol before the .org.",
					location: expect.objectContaining({ line }),
				});
			// A label it would place itself: it was a crash.
			expect(() =>
				createAssembler().assemble(`.org later
later:`),
			).toThrow(error(1));
			expect(() =>
				createAssembler().assemble(`nop
.org later + 1
nop
later: nop`),
			).toThrow(error(2));
			// A constant: the code in between can't be placed in pass 1 either.
			expect(() =>
				createAssembler().assemble(`.org later
lbl: nop
later = $2000`),
			).toThrow(error(1));
			expect(() =>
				createAssembler().assemble(`.org later
nop
later = $2000`),
			).toThrow(error(1));
		});

		it("should take a symbol defined before it", () => {
			const asm = createAssembler();
			asm.assemble(`later = $1002
.org later
lbl: nop`);
			expect(asm.symbolTable.lookupSymbol("LBL")).toBe(0x1002);
			expect(asm.link()).toEqual([0, 0, 0xea]);
		});
	});

	describe("*", () => {
		it("should fail if value is not a number", () => {
			const source = `
            * = "test"
        `;
			const asm = createAssembler();
			expect(() => asm.assemble(source)).toThrow("Invalid value for */ORG: test.");
		});

		it("should refuse a symbol defined after it, as .org", () => {
			expect(() =>
				createAssembler().assemble(`* = later
later:`),
			).toThrow("The * = address uses a symbol defined after it: define the symbol before the * =.");
		});

		it("should handle multiple * assign", () => {
			const source = `
            .cpu "6502"
            * = $2000
            NOP
            * = $2010
            NOP
        `;
			const asm = createAssembler();
			const segments = asm.assemble(source);
			expect(segments[0]).toBeDefined();
			if (segments[0]) {
				const offset1 = 0x2000 - segments[0].start;
				expect(segments[0].data[offset1]).toBe(0xea); // NOP

				const offset2 = 0x2010 - segments[0].start;
				expect(segments[0].data[offset2]).toBe(0xea); // NOP
			}
		});

		it("should take '=' glued to it, and a label before it", () => {
			const source = `
            *=$1002
            NOP
            start * = $1004
            NOP
            .dw start
        `;
			expect(createAssembler().assemble(source)[0]?.data).toEqual([0, 0, 0xea, 0, 0xea, 0x03, 0x10]);
		});

		it.each(["*", "* nop", "*:", "* $10"])("should refuse '%s': only '* =' starts a statement with it", (statement) => {
			const error = () => createAssembler().assemble(statement);
			expect(error).toThrow("Syntax error - Expected '=' after '*': set the PC with '.org $1000'.");
		});

		it("should refuse the '=' on the next line", () => {
			const source = `
            *
            = $2000
        `;
			expect(() => createAssembler().assemble(source)).toThrow("Syntax error - Expected '=' after '*': set the PC with '.org $1000'.");
		});

		it("should refuse it after an unknown mnemonic, read as a label", () => {
			expect(() => createAssembler().assemble("brl *")).toThrow("Syntax error - (Unknown opcode?) Unexpected '*' after BRL");
			expect(() => createAssembler().assemble("foo *")).toThrow("Syntax error - (Unknown opcode?) Unexpected '*' after FOO");
		});
	});
});
