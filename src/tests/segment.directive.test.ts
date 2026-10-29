import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Segments", () => {
	it("should define and use a new segment", () => {
		const cpu = new Cpu6502Handler();
		const assembler = new Assembler(cpu, new MockFileHandler());
		const source = `
		.SEGMENT CODE { start: 0x8000, end: 0x8FFF }
		.SEGMENT "VECTORS" { start: 0xFFFA, end: 0xFFFF, pad: 0xEA }

		.SEGMENT "CODE"
		LDA #$42
		JMP $1234

		.SEGMENT "VECTORS"
		.WORD $8000
		`;

		const segments = assembler.assemble(source);

		const codeSegment = segments.find((s) => s.name === "CODE");
		expect(codeSegment).toBeDefined();
		expect(codeSegment?.start).toBe(0x8000);
		expect(codeSegment?.size).toBe(0x1000);
		expect(codeSegment?.data.slice(0, 5)).toEqual([0xa9, 0x42, 0x4c, 0x34, 0x12]);

		const vectorsSegment = segments.find((s) => s.name === "VECTORS");
		expect(vectorsSegment).toBeDefined();
		expect(vectorsSegment?.start).toBe(0xfffa);
		expect(vectorsSegment?.size).toBe(6);
		expect(vectorsSegment?.padValue).toBe(0xea);

		// Check the content of the vectors segment
		// .WORD $8000 should be at the start of VECTORS (0xFFFA)
		// Followed by pad value
		const expectedVectors = [0x00, 0x80, 0xea, 0xea, 0xea, 0xea];
		expect(vectorsSegment?.data).toEqual(expectedVectors);
	});

	it("should throw an error for incomplete segment definition", () => {
		const cpu = new Cpu6502Handler();
		const assembler = new Assembler(cpu, new MockFileHandler());
		const source = `
      .SEGMENT "INCOMPLETE" { start: 0x1000 }
    `;
		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: ".SEGMENT definition requires 'start','end' or 'start','size' parameters.",
				location: expect.objectContaining({ line: 2 }),
			}),
		);
	});

	it("should throw an error for invalid end address", () => {
		const cpu = new Cpu6502Handler();
		const assembler = new Assembler(cpu, new MockFileHandler());
		const source = `
      .SEGMENT "BAD" { start: 0x2000, end: 0x1000 }
    `;
		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: ".SEGMENT 'end' address must be greater than or equal to 'start' address.",
				location: expect.objectContaining({ line: 2 }),
			}),
		);
	});

	it("should handle expressions in segment definitions", () => {
		const cpu = new Cpu6502Handler();
		const assembler = new Assembler(cpu, new MockFileHandler());
		const source = `
		  START_ADDR = 0xC000
		  END_ADDR = 0xC00F
		  .SEGMENT "EXPR_SEG" { start: START_ADDR, end: END_ADDR, pad: 2*8 }

		  .SEGMENT EXPR_SEG
		  .BYTE $CA, $FE
		`;

		const segments = assembler.assemble(source);
		const seg = segments.find((s) => s.name === "EXPR_SEG");
		expect(seg).toBeDefined();
		expect(seg?.start).toBe(0xc000);
		expect(seg?.size).toBe(16);
		expect(seg?.padValue).toBe(16);
		expect(seg?.data.slice(0, 2)).toEqual([0xca, 0xfe]);
		expect(seg?.data[2]).toBe(16);
	});

	it("should handle end or size expressions in segment definitions", () => {
		const cpu = new Cpu6502Handler();
		const assembler = new Assembler(cpu, new MockFileHandler());
		const source = `
		  .SEGMENT END_SEG { start: $800, end: $8FF }
		  .SEGMENT SIZE_SEG { start: $A00, size: $100 }
		`;

		const segments = assembler.assemble(source);
		let seg = segments.find((s) => s.name === "END_SEG");
		expect(seg).toBeDefined();
		expect(seg?.start).toBe(0x0800);
		expect(seg?.size).toBe(256);

		seg = segments.find((s) => s.name === "SIZE_SEG");
		expect(seg).toBeDefined();
		expect(seg?.start).toBe(0x0a00);
		expect(seg?.size).toBe(256);
	});

	it.each([
		// a property spread over lines: the error is at the property, not at the .SEGMENT
		[
			".SEGMENT CODE {\n  start: $1000,\n  size: 1,\n  foo: 1,\n  FOO: 2\n}",
			"The .SEGMENT definition gives the attribute 'foo' twice.",
			{ line: 5, column: 3 },
		],
		[".SEGMENT CODE { start: $1000, 5 }", "Expected 'key: value' in the .SEGMENT definition, got '5'.", { line: 1, column: 31 }],
		[".SEGMENT X { start: $1000, start: $2000, size: 4 }", "The .SEGMENT definition gives 'start' twice.", { line: 1, column: 28 }],
		[".SEGMENT X { start: $1000, end: $10FF, END: $11FF }", "The .SEGMENT definition gives 'end' twice.", { line: 1, column: 40 }],
		[".SEGMENT X { start: $1000, size: 4, Size: 8 }", "The .SEGMENT definition gives 'size' twice.", { line: 1, column: 37 }],
		[".SEGMENT X { start: $1000, size: 4, pad: 1, pad: 2 }", "The .SEGMENT definition gives 'pad' twice.", { line: 1, column: 45 }],
		[".SEGMENT X { start: $1000, end: $1003, size: 8 }", "The .SEGMENT definition gives both 'end' and 'size': give one of them.", { line: 1, column: 40 }],
		[".SEGMENT X { size: 8, start: $1000, end: $1003 }", "The .SEGMENT definition gives both 'end' and 'size': give one of them.", { line: 1, column: 37 }],
		[".SEGMENT X { reloc: true, size: 4, size: 8 }", "The .SEGMENT definition gives 'size' twice.", { line: 1, column: 36 }],
	])("should report a .SEGMENT definition error at its token: %j", (source, message, location) => {
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler());
		expect(() => assembler.assemble(source)).toThrow(expect.objectContaining({ message, location: expect.objectContaining(location) }));
	});

	it("should fail on duplicate segment names", () => {
		const cpu = new Cpu6502Handler();
		const assembler = new Assembler(cpu, new MockFileHandler());
		const source = `
		  .SEGMENT SEG { start: $800, end: $8FF }
		  .SEGMENT SEG { start: $A00, size: $100 }
		`;

		expect(() => assembler.assemble(source)).toThrow(/Segment already defined : SEG/);
	});

	it("should fail, at its line, on a write that starts in a fixed segment and goes past its end", () => {
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler());
		const source = ".SEGMENT SEG { start: $800, size: 4 }\n.SEGMENT SEG\n  nop\n  .byte 1, 2, 3, 4";
		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: "Write out of bounds: address $804 outside fixed segment 'SEG' (start $800, size 4).",
				location: expect.objectContaining({ line: 4, column: 3 }),
			}),
		);
	});

	describe("pass 2 starts where pass 1 started", () => {
		const createAssembler = () =>
			new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
				segments: [
					{ name: "A", start: 0x1000, size: 0, resizable: true },
					{ name: "B", start: 0x1004, size: 0, resizable: true },
				],
			});

		it("should start pass 2 in the first segment, not the last one used", () => {
			const assembler = createAssembler();
			assembler.assemble(".db 1\n.segment B\n.db 2");
			expect(assembler.link()).toEqual([0x01, 0, 0, 0, 0x02]);
		});

		it("should resolve a forward label in another segment", () => {
			const assembler = createAssembler();
			assembler.assemble(" jmp b1\n.segment B\nb1: rts");
			expect(assembler.link()).toEqual([0x4c, 0x04, 0x10, 0, 0x60]);
		});

		it("should not write code placed before any segment is selected", () => {
			const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler());
			expect(() => assembler.assemble(".segment S { start: $2000, size: 2 }\n.db 1\n.segment S\n.db 2")).toThrow(
				"No active segment for the bytes at $1000",
			);
		});
	});

	describe("selecting a segment again", () => {
		const assemble = (source: string) => {
			const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
				segments: [
					{ name: "A", start: 0x1000, size: 0, resizable: true },
					{ name: "B", start: 0x1008, size: 0, resizable: true },
				],
			});
			assembler.assemble(source);
			return assembler.link();
		};

		it("should continue where the segment left off", () => {
			expect(assemble(".db 1\n.segment B\n.db 2\n.segment A\n.db 3")).toEqual([0x01, 0x03, 0, 0, 0, 0, 0, 0, 0x02]);
		});

		it("should continue after an .org", () => {
			expect(assemble(".org $1004\n.db 9\n.segment B\n.db 2\n.segment A\n.db 3")).toEqual([0, 0, 0, 0, 0x09, 0x03, 0, 0, 0x02]);
		});

		it("should resolve labels across the switches", () => {
			// a2 follows a1 in A ($1001); b1 is B's start ($1008)
			expect(assemble("a1: .db 1\n.segment B\nb1: jmp a2\n.segment A\na2: jmp b1")).toEqual([0x01, 0x4c, 0x08, 0x10, 0, 0, 0, 0, 0x4c, 0x01, 0x10]);
		});
	});

	describe("a fixed segment needs a start", () => {
		it("should reject a definition with a size and no start", () => {
			const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler());
			expect(() => assembler.assemble(`.segment X { size: 4 }`)).toThrow(".SEGMENT definition requires 'start','end' or 'start','size' parameters.");
		});

		it("should reject a project segment with no start", () => {
			expect(() => new Assembler(new Cpu6502Handler(), new MockFileHandler(), { segments: [{ name: "X", size: 4 }] })).toThrow(
				"Segment 'X' needs a 'start' address, or 'relocatable: true'.",
			);
		});

		it("should reject a project segment with no size", () => {
			expect(() => new Assembler(new Cpu6502Handler(), new MockFileHandler(), { segments: [{ name: "X", start: 0x1000 }] })).toThrow(
				"Segment 'X' needs a 'size'.",
			);
		});
	});

	describe("relocatable segments", () => {
		const assemble = (source: string) => {
			const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler());
			return assembler.assemble(source);
		};

		it.each(["reloc", "relocatable", "RELOC"])("should define a relocatable segment with '%s: true', starting at 0", (key) => {
			const segments = assemble(`
				.segment CODE { ${key}: true, size: 4 }
				.segment CODE
				lda #1
			`);
			expect(segments[0]).toMatchObject({ name: "CODE", start: 0, size: 4, relocatable: true, resizable: false, data: [0xa9, 0x01, 0, 0] });
		});

		it("should grow without a size", () => {
			const segments = assemble(`
				.segment CODE { reloc: true }
				.segment CODE
				lda #1
				rts
			`);
			expect(segments[0]).toMatchObject({ start: 0, size: 3, relocatable: true, resizable: true, data: [0xa9, 0x01, 0x60] });
		});

		it("should define a fixed segment with 'reloc: false'", () => {
			const segments = assemble(`.segment CODE { start: $1000, size: 2, reloc: FALSE }`);
			expect(segments[0]).toMatchObject({ start: 0x1000, size: 2, relocatable: false });
		});

		it("should mark a fixed segment as not relocatable", () => {
			const segments = assemble(`.segment CODE { start: $1000, size: 2 }`);
			expect(segments[0]?.relocatable).toBe(false);
		});

		it("should reject a start", () => {
			expect(() => assemble(`.segment CODE { reloc: true, start: $1000, size: 4 }`)).toThrow(
				expect.objectContaining({
					message: "A relocatable segment has no 'start': its address is only known when it's loaded.",
					location: expect.objectContaining({ line: 1, column: 30 }),
				}),
			);
		});

		it("should reject an end", () => {
			expect(() => assemble(`.segment CODE { end: $10, reloc: true }`)).toThrow(
				"A relocatable segment has no 'end': give its 'size', or none for a segment that grows.",
			);
		});

		it.each(["1", "yes", "true + 1"])("should reject '%s' as its value", (value) => {
			expect(() => assemble(`.segment CODE { reloc: ${value} }`)).toThrow(".SEGMENT property 'reloc' must be true or false.");
		});

		it("should reject reloc and relocatable together", () => {
			expect(() => assemble(`.segment CODE { reloc: true, relocatable: true }`)).toThrow(
				"The .SEGMENT definition gives 'relocatable' twice ('reloc' is the same property).",
			);
		});

		it.each([".org $10", "* = $10"])("should reject '%s' in it", (org) => {
			expect(() =>
				assemble(`
					.segment CODE { reloc: true }
					.segment CODE
					${org}
				`),
			).toThrow("Segment 'CODE' is relocatable: it has no address until it's loaded, so .ORG and * = can't set one.");
		});

		it("should accept .org in a fixed segment after a relocatable one", () => {
			const segments = assemble(`
				.segment R { reloc: true }
				.segment F { start: $1000, size: 0 }
				.segment R
				nop
				.segment F
				.org $1002
				nop
			`);
			expect(segments[1]).toMatchObject({ start: 0x1000, data: [0, 0, 0xea] });
		});

		describe("in the project file", () => {
			const create = (segments: SegmentDefinition[]) => new Assembler(new Cpu6502Handler(), new MockFileHandler(), { segments });

			it.each(["reloc", "relocatable"])("should define one with '%s: true', growing without a size", (key) => {
				const segments = create([{ name: "CODE", [key]: true }]).assemble(`
					lda #1
				`);
				expect(segments[0]).toMatchObject({ name: "CODE", start: 0, relocatable: true, resizable: true, data: [0xa9, 0x01] });
			});

			it("should keep a fixed size when given", () => {
				const segments = create([{ name: "CODE", relocatable: true, size: 4 }]).assemble(`
					lda #1
				`);
				expect(segments[0]).toMatchObject({ start: 0, size: 4, relocatable: true, resizable: false, data: [0xa9, 0x01, 0, 0] });
			});

			it("should reject a start", () => {
				expect(() => create([{ name: "CODE", reloc: true, start: 0x1000 }])).toThrow(
					"Segment 'CODE' is relocatable: it has no 'start', its address is only known when it's loaded.",
				);
			});

			it("should reject reloc and relocatable together", () => {
				expect(() => create([{ name: "CODE", reloc: true, relocatable: false }])).toThrow(
					"Segment 'CODE' gives 'relocatable' twice ('reloc' is the same property).",
				);
			});
		});
	});
});
