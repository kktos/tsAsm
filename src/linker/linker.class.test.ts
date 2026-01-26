import { beforeEach, describe, expect, it } from "vitest";
import { Linker } from "./linker.class";

describe("Linker", () => {
	let linker: Linker;

	beforeEach(() => {
		linker = new Linker(0);
	});

	it("should be created", () => {
		expect(linker).toBeTruthy();
	});

	describe("addSegment", () => {
		it("should add a new segment", () => {
			linker.addSegment("CODE", 0x100, 0x10);
			expect(linker.segments.length).toBe(1);
			expect(linker.segments[0]?.name).toBe("CODE");
			expect(linker.segments[0]?.start).toBe(0x100);
			expect(linker.segments[0]?.size).toBe(0x10);
			expect(linker.segments[0]?.data.length).toBe(0x10);
			expect(linker.segments[0]?.data.every((v) => v === 0)).toBe(true);
		});

		it("should add a segment with a pad value", () => {
			linker.addSegment("DATA", 0x200, 0x8, 0xff);
			expect(linker.segments.length).toBe(1);
			expect(linker.segments[0]?.name).toBe("DATA");
			expect(linker.segments[0]?.padValue).toBe(0xff);
			expect(linker.segments[0]?.data.every((v) => v === 0xff)).toBe(true);
		});

		it("should add a resizable segment with zero size", () => {
			linker.addSegment("BSS", 0x300, 0, 0, true);
			expect(linker.segments.length).toBe(1);
			const seg = linker.segments[0];
			expect(seg?.name).toBe("BSS");
			expect(seg?.resizable).toBe(true);
			expect(seg?.size).toBe(0);
			expect(seg?.data.length).toBe(0);
		});
	});

	describe("useSegment", () => {
		it("should select an existing segment", () => {
			linker.addSegment("CODE", 0x100, 0x10);
			linker.addModule("MAIN");
			linker.useSegment("CODE");
			expect(linker.currentSegment).toBeDefined();
			expect(linker.currentSegment?.name).toBe("CODE");
		});

		it("should throw an error for a non-existent segment", () => {
			expect(() => linker.useSegment("NONEXISTENT")).toThrow("Segment not found: NONEXISTENT");
		});
	});

	describe("writeByte", () => {
		beforeEach(() => {
			linker.addSegment("CODE", 0x100, 0x10);
			linker.addSegment("BSS", 0x200, 0, 0, true);
		});

		it("should throw if no segment is active", () => {
			expect(() => linker.writeBytes(0x100, [0x42])).toThrow("Internal error: no active segment.");
		});

		it("should write a byte to the current segment", () => {
			linker.addModule("MAIN");
			linker.useSegment("CODE");
			linker.writeBytes(0x105, [0x42]);
			expect(linker.currentSegment?.data[5]).toBe(0x42);
		});

		it("should throw when writing below segment start", () => {
			linker.addModule("MAIN");
			linker.useSegment("CODE");
			expect(() => linker.writeBytes(0xff, [0x42])).toThrow("Write out of bounds: address $FF is below segment 'CODE' start $100.");
		});

		it("should throw when writing outside a fixed segment", () => {
			linker.addModule("MAIN");
			linker.useSegment("CODE");
			expect(() => linker.writeBytes(0x110, [0x42])).toThrow("Write out of bounds: address $110 outside fixed segment 'CODE' (start $100, size 16).");
		});

		it("should resize a resizable segment when writing past its end", () => {
			linker.addModule("MAIN");
			linker.useSegment("BSS");
			linker.writeBytes(0x200, [0xaa]);
			linker.writeBytes(0x201, [0xbb]);
			const seg = linker.segments.find((s) => s.name === "BSS");
			expect(seg?.data.length).toBe(2);
			expect(seg?.size).toBe(2);
			expect(seg?.data[0]).toBe(0xaa);
			expect(seg?.data[1]).toBe(0xbb);
		});

		it("should handle non-sequential writes in resizable segment", () => {
			linker.addModule("MAIN");
			linker.useSegment("BSS");
			linker.writeBytes(0x204, [0xcc]);
			const seg = linker.segments.find((s) => s.name === "BSS");
			expect(seg?.data.length).toBe(5);
			expect(seg?.size).toBe(5);
			expect(seg?.data[0]).toBe(0);
			expect(seg?.data[4]).toBe(0xcc);
		});
	});

	describe("link", () => {
		it("should return an empty array if no segments are present", () => {
			expect(linker.rawBinaryLink()).toEqual([]);
		});

		it("should link a single segment", () => {
			linker.addModule("MAIN");
			linker.addSegment("CODE", 0x100, 4, 0);
			linker.useSegment("CODE");
			linker.writeBytes(0x100, [1]);
			linker.writeBytes(0x101, [2]);
			linker.writeBytes(0x102, [3]);
			linker.writeBytes(0x103, [4]);
			expect(linker.rawBinaryLink()).toEqual([1, 2, 3, 4]);
		});

		it("should link multiple segments, filling gaps with zeros", () => {
			linker.addModule("MAIN");
			linker.addSegment("SEG1", 0x10, 2);
			linker.useSegment("SEG1");
			linker.writeBytes(0x10, [0xaa]);
			linker.writeBytes(0x11, [0xbb]);

			linker.addSegment("SEG2", 0x14, 2);
			linker.useSegment("SEG2");
			linker.writeBytes(0x14, [0xcc]);
			linker.writeBytes(0x15, [0xdd]);

			// SEG1 at 0x10, size 2 -> [0xaa, 0xbb]
			// Gap of 2 bytes (0x12, 0x13)
			// SEG2 at 0x14, size 2 -> [0xcc, 0xdd]
			// minStart = 0x10, maxEnd = 0x16. outSize = 6
			expect(linker.rawBinaryLink()).toEqual([0xaa, 0xbb, 0, 0, 0xcc, 0xdd]);
		});

		it("should handle overlapping segments, last segment wins", () => {
			linker.addModule("MAIN");
			linker.addSegment("SEG1", 0x10, 4);
			linker.useSegment("SEG1");
			linker.writeBytes(0x10, [1]);
			linker.writeBytes(0x11, [2]);
			linker.writeBytes(0x12, [3]);
			linker.writeBytes(0x13, [4]);

			linker.addSegment("SEG2", 0x12, 4);
			linker.useSegment("SEG2");
			linker.writeBytes(0x12, [5]);
			linker.writeBytes(0x13, [6]);
			linker.writeBytes(0x14, [7]);
			linker.writeBytes(0x15, [8]);

			expect(linker.rawBinaryLink()).toEqual([1, 2, 5, 6, 7, 8]);
		});

		it("should use padValue for unfilled parts of segments", () => {
			linker.addModule("MAIN");
			linker.addSegment("DATA", 0x100, 5, 0xff);
			linker.useSegment("DATA");
			linker.writeBytes(0x100, [0xda]);
			linker.writeBytes(0x101, [0xdb]);
			expect(linker.rawBinaryLink()).toEqual([0xda, 0xdb, 0xff, 0xff, 0xff]);
		});
	});

	describe("Inline Sections", () => {
		it("should append data correctly between segments", () => {
			linker.addModule("MAIN");
			linker.addSegment("SEG1", 0x100, 2);
			linker.useSegment("SEG1");
			linker.writeBytes(0x100, [0xaa, 0xbb]);

			linker.addSegment("SEG2", 0x200, 2);
			linker.useSegment("SEG2");
			linker.writeBytes(0x200, [0xcc, 0xdd]);

			// 1. Emit SEG1
			linker.emitSegment("SEG1");

			// 2. Inline Section
			linker.addInlineSection("MIDDLE");
			linker.emitByte(0x11);
			linker.emitByte(0x22);

			// 3. Emit SEG2
			linker.emitSegment("SEG2");

			// Verify final output
			expect(linker.currentSegment.data).toEqual([0xaa, 0xbb, 0x11, 0x22, 0xcc, 0xdd]);
		});
	});

	describe("Script Execution", () => {
		it("should handle .SECTION directives correctly in a script", () => {
			linker.addModule("MAIN");
			linker.addSegment("CODE", 0, 2);
			linker.useSegment("CODE");
			linker.writeBytes(0, [0xaa, 0xbb]);

			linker.addSegment("DATA", 0, 2);
			linker.useSegment("DATA");
			linker.writeBytes(0, [0xcc, 0xdd]);

			const script = `
				.OUTPUT "test.bin"
				.WRITE SEGMENT "CODE"

				.WRITE BYTE 0x11
				.WRITE BYTE 0x22

				.SECTION INLINE
				.WRITE BYTE 0x33

				.WRITE SEGMENT "DATA"

				.SECTION OVERLAY AT 0x01
				.WRITE BYTE 0xFF
			`;
			const logger = {
				log: () => {},
				warn: () => {},
				error: (m: any) => {
					throw new Error(m);
				},
			} as any;
			const result = linker.link(script, undefined, logger);

			expect(result.data).toEqual([0xaa, 0xff, 0x11, 0x22, 0x33, 0xcc, 0xdd]);
		});
	});

	describe("Stateful Segments", () => {
		it("should track emitted status and expose UNWRITTEN_SEGMENTS", () => {
			linker.addModule("MAIN");
			linker.addSegment("BOOT", 0, 1);
			linker.useSegment("BOOT");
			linker.writeBytes(0, [0xaa]);

			linker.addSegment("CODE", 0, 1);
			linker.useSegment("CODE");
			linker.writeBytes(0, [0xbb]);

			linker.addSegment("DATA", 0, 1);
			linker.useSegment("DATA");
			linker.writeBytes(0, [0xcc]);

			const script = `
				.OUTPUT "test.bin"
				.WRITE SEGMENT "BOOT"
				.FOR s OF .UNWRITTEN_SEGMENTS
					.WRITE SEGMENT(s.name)
				.END
			`;
			const logger = {
				log: () => {},
				warn: () => {},
				error: (m: any) => {
					throw new Error(m);
				},
			} as any;
			const result = linker.link(script, undefined, logger);

			expect(result.data).toEqual([0xaa, 0xbb, 0xcc]);
		});
	});

	describe("Hybrid SEGMENTS Variable", () => {
		it("should behave as both an array and a map", () => {
			linker.addModule("MAIN");
			linker.addSegment("SEG_A", 0x10, 1);
			linker.addSegment("SEG_B", 0x20, 1);

			const script = `
				.OUTPUT "test.bin"
				# Map access
				.WRITE BYTE(SEGMENTS.SEG_A.start)
				.WRITE BYTE(SEGMENTS.SEG_B.start)

				# Array iteration
				.FOR s OF SEGMENTS
					.WRITE BYTE(s.start)
				.END
			`;
			const logger = {
				log: () => {},
				warn: () => {},
				error: (m: any) => {
					throw new Error(m);
				},
			} as any;
			const result = linker.link(script, undefined, logger);

			// Map access: 0x10, 0x20. Array iteration: 0x10, 0x20.
			expect(result.data).toEqual([0x10, 0x20, 0x10, 0x20]);
		});
	});
});
