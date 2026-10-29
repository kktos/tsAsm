import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

const newAssembler = (segments?: SegmentDefinition[], sink = new MemorySink()) =>
	new Assembler(new Cpu6502Handler(), new MockFileHandler(), { logger: new Logger({ sink, enabled: true }), segments, log: { pass1Enabled: true } });

/** Each segment's attributes, by name, after assembling `source`. */
function attributes(source: string, segments?: SegmentDefinition[]) {
	return Object.fromEntries(
		newAssembler(segments)
			.assemble(source)
			.map((s) => [s.name, s.attrs]),
	);
}

/** The output of the linker `script`, after assembling `source`. */
function link(source: string, script: string) {
	const assembler = newAssembler();
	assembler.assemble(source);
	return assembler.linker.link(script, undefined, new Logger({ sink: new MemorySink(), enabled: false })).data;
}

describe("Segment attributes", () => {
	describe("in .segment", () => {
		it("should keep any other key as an attribute, in lowercase, a number or a string", () => {
			const source = `
				KIND_CODE = $1000
				.segment CODE { reloc: true, KIND: KIND_CODE | $8000, LoadName: "MA" + "IN" }
				.segment VECTORS { start: $FFFA, size: 6, kind: 1 }
			`;
			expect(attributes(source)).toEqual({ CODE: { kind: 0x9000, loadname: "MAIN" }, VECTORS: { kind: 1 } });
		});

		it("should give a segment without attributes an empty set", () => {
			expect(attributes(".segment CODE { start: $1000, size: 2 }")).toEqual({ CODE: {} });
		});

		it.each([
			[".segment CODE {\n  reloc: true,\n  kind: 1,\n  KIND: 2\n}", "The .SEGMENT definition gives the attribute 'kind' twice.", { line: 4, column: 3 }],
			[".segment CODE { reloc: true, kind: [1, 2] }", ".SEGMENT attribute 'kind' must be a number or a string.", { line: 1, column: 36 }],
			[
				".segment CODE { reloc: true }\n.segment CODE\nmain:\n.segment DATA { reloc: true, kind: main }",
				".SEGMENT attribute 'kind': CODE+$0000 is relocatable, and an attribute is a number or a string.",
				{ line: 4, column: 36 },
			],
			[
				".segment CODE { reloc: true, kind: LATER }\nLATER = 1",
				".SEGMENT: 'LATER' must be defined before it is used here (the attribute 'kind' is read where the segment is defined).",
				{ line: 1, column: 36 },
			],
		])("should report a wrong attribute at its token: %j", (source, message, location) => {
			expect(() => newAssembler().assemble(source)).toThrow(expect.objectContaining({ message, location: expect.objectContaining(location) }));
		});

		it("should list them after the segment's bounds", () => {
			const sink = new MemorySink();
			newAssembler(undefined, sink).assemble(`.segment CODE { reloc: true, kind: $1000, loadname: "MAIN" }`);
			expect(sink.logs.some((line) => String(line).includes(`{ relocatable, size: $00, pad: $00, kind: $1000, loadname: "MAIN" }`))).toBe(true);
		});
	});

	describe("in the project file's segments", () => {
		it("should keep any other key as an attribute, in lowercase, a number or a string", () => {
			const segments = [
				{ name: "CODE", reloc: true, KIND: 0x1000, LoadName: "MAIN" },
				{ name: "DATA", start: 0x2000, size: 0, kind: 1 },
			];
			expect(attributes("", segments)).toEqual({ CODE: { kind: 0x1000, loadname: "MAIN" }, DATA: { kind: 1 } });
		});

		it.each([
			[{ name: "CODE", reloc: true, kind: 1, KIND: 2 }, "Segment 'CODE' gives the attribute 'kind' twice."],
			[{ name: "CODE", reloc: true, banked: true }, "Segment 'CODE': attribute 'banked' must be a number or a string."],
			[{ name: "CODE", size: 2, Start: 0x1000 }, "Segment 'CODE': 'Start' is written 'start'."],
		])("should report a wrong attribute: %j", (segment, message) => {
			expect(() => newAssembler([segment]).assemble("")).toThrow(message);
		});
	});

	describe("read by the linker script", () => {
		it("should read an attribute as seg.attrs.<key>", () => {
			const source = `.segment CODE { reloc: true, kind: $1000, loadname: "MAIN" }\n.segment CODE\nnop`;
			const script = `
				code = .segment("CODE")
				.WRITE WORD code.attrs.kind
				.WRITE STRING code.attrs.loadname
				.WRITE SEGMENT "CODE"
			`;
			expect(link(source, script)).toEqual([0x00, 0x10, 0x4d, 0x41, 0x49, 0x4e, 0xea]);
		});

		it("should fail on an attribute the segment doesn't have", () => {
			const source = ".segment CODE { start: $1000, size: 1 }";
			expect(() => link(source, `code = .segment("CODE")\n.WRITE WORD code.attrs.kind`)).toThrow("Property 'kind' does not exist on object.");
		});
	});
});
