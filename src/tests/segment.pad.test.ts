import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

const newAssembler = (segments?: SegmentDefinition[]) =>
	new Assembler(new Cpu6502Handler(), new MockFileHandler(), { logger: new Logger({ sink: new MemorySink(), enabled: false }), segments });

/** The output of the linker `script`, after assembling `source`. */
function link(source: string, script: string, segments?: SegmentDefinition[]) {
	const assembler = newAssembler(segments);
	assembler.assemble(source);
	return assembler.linker.link(script, undefined, new Logger({ sink: new MemorySink(), enabled: false })).data;
}

describe("A segment's pad", () => {
	describe("in the project file's segments", () => {
		it("should fill the segment with it, not be an attribute", () => {
			const source = `
				.segment DATA
				.byte 1
			`;
			const [segment] = newAssembler([{ name: "DATA", start: 0x2000, size: 4, pad: 0xff }]).assemble(source);
			expect(segment).toMatchObject({ pad: 0xff, attrs: {}, data: [1, 0xff, 0xff, 0xff] });
		});

		it.each([
			[{ name: "DATA", start: 0x2000, size: 4, padValue: 0xff }, "Segment 'DATA': 'padValue' is written 'pad'."],
			[{ name: "DATA", start: 0x2000, size: 4, PAD: 0xff }, "Segment 'DATA': 'PAD' is written 'pad'."],
		])("should refuse %j", (segment, message) => {
			expect(() => newAssembler([segment])).toThrow(message);
		});
	});

	describe("read by the linker script", () => {
		it("should be seg.pad", () => {
			const source = `
				.segment CODE { start: $1000, size: 1, pad: $EA }
				.segment DATA { start: $2000, size: 1 }
			`;
			const script = `
				.WRITE BYTE .segment("CODE").pad
				.WRITE BYTE .segment("DATA").pad
			`;
			expect(link(source, script)).toEqual([0xea, 0]);
		});
	});
});
