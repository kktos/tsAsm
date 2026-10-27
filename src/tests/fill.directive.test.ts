import { beforeEach, describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import type { Segment } from "../linker/linker.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Directive: .fill", () => {
	let asm: Assembler;
	let segments: Segment[];

	beforeEach(() => {
		const cpu = new Cpu6502Handler();
		const fileHandler = new MockFileHandler();
		asm = new Assembler(cpu, fileHandler);
	});

	it("should fill a block of memory with a specified value", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .fill 5, $AB
        `;
		segments = asm.assemble(source);

		// expect(asm.PC.value).toBe(0x2005);

		const segment = segments[0];
		if (!segment) throw new Error("No segment found");

		const offset = 0x2000 - segment.start;
		const filledData = segment.data.slice(offset, offset + 5);
		expect(filledData).toEqual([0xab, 0xab, 0xab, 0xab, 0xab]);
	});

	it("should fill with 0 if no value is provided", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .fill 3
        `;
		segments = asm.assemble(source);

		// expect(asm.currentPC).toBe(0x2003);
		const segment = segments[0];
		if (!segment) throw new Error("No segment found");

		const offset = 0x2000 - segment.start;
		const filledData = segment.data.slice(offset, offset + 3);
		expect(filledData).toEqual([0, 0, 0]);
	});

	it("should evaluate expressions for count and value", () => {
		const source = `
            .cpu "6502"
            .org $2000
            value = $CC
            count = 2 * 2
            .fill count, value
        `;
		segments = asm.assemble(source);

		// expect(asm.currentPC).toBe(0x2004);
		const segment = segments[0];
		if (!segment) throw new Error("No segment found");

		const offset = 0x2000 - segment.start;
		const filledData = segment.data.slice(offset, offset + 4);
		expect(filledData).toEqual([0xcc, 0xcc, 0xcc, 0xcc]);
	});

	it("should do nothing if count is 0", () => {
		const source = `
            .cpu "6502"
            .org $2000
            .fill 0, $FF
            LDA #$42
        `;
		segments = asm.assemble(source);

		// expect(asm.currentPC).toBe(0x2002);
		const segment = segments[0];
		if (!segment) throw new Error("No segment found");

		const offset = 0x2000 - segment.start;
		expect(segment.data[offset]).toBe(0xa9); // LDA immediate
		expect(segment.data[offset + 1]).toBe(0x42);
	});

	it.each([".fill [2,3][0], $AB", ".fill .iif(1,2,3), $AB"])("should only split %s at its top-level comma", (directive) => {
		const source = `
			${directive}
			.db 1
		`;
		segments = asm.assemble(source);
		expect(segments[0]?.data).toEqual([0xab, 0xab, 1]);
	});

	it.each([
		[".fill -5, $FF", ".FILL count: -5"],
		[".ds -1", ".DS count: -1"],
		[".fill 5/2", ".FILL count: 2.5"],
		[".fill count\ncount = -2", ".FILL count: -2"],
	])("should throw on a count that isn't a whole number of 0 or more: %j", (source, message) => {
		expect(() => asm.assemble(`.org $2000\n${source}\nlabel: LDA #$42`)).toThrow(
			expect.objectContaining({
				message: `${message} isn't a whole number of bytes (0 or more).`,
				location: expect.objectContaining({ line: 2 }),
			}),
		);
	});

	describe("listing", () => {
		/** The pass 2 listing lines that have bytes, each from its address up to the directive. */
		function listBytes(source: string): string[] {
			const sink = new MemorySink();
			const lister = new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
				logger: new Logger({ sink, enabled: true }),
				log: { pass2Enabled: true },
			});
			lister.assemble(source);
			return sink.logs.filter((line) => /^[0-9A-F]{4}: [0-9A-F]{2} /.test(line)).map((line) => line.replace(/\s+/g, " ").trim());
		}

		it("lists a .fill at the address it starts at", () => {
			const listing = listBytes(`
				.org $1000
				nop
				.db 1
				.fill 4, 2
				nop
			`);
			expect(listing.map((line) => line.slice(0, 5))).toEqual(["1000:", "1001:", "1002:", "1006:"]);
			expect(listing[2]).toMatch(/^1002: 02 02 02 02 \.FILL \$04, \$02/i);
		});

		it("lists each .fill of a loop at the address it starts at", () => {
			const listing = listBytes(`
				.org $1080
				.repeat 4 AS r FROM 0
				.fill 16, $E9 + r
				.end
			`);
			// The listing writes 8 bytes per line.
			expect(listing.map((line) => line.slice(0, 5))).toEqual(["1080:", "1088:", "1090:", "1098:", "10A0:", "10A8:", "10B0:", "10B8:"]);
			expect(listing[0]).toMatch(/^1080: (E9 ){8}\.FILL \$10, \$E9/i);
			expect(listing[6]).toMatch(/^10B0: (EC ){8}\.FILL \$10, \$EC/i);
		});
	});
});
