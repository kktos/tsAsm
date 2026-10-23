import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

// Minimal fake CPU handler
const fakeCPU = {
	cpuType: "FakeCPU",
	isInstruction: () => false,
	resolveAddressingMode: () => ({
		mode: "",
		opcode: 0,
		bytes: 0,
		resolvedAddress: 0,
	}),
	encodeInstruction: () => [],
	endianness: "little" as const,
};

describe(".ALIGN", () => {
	const createAssembler = (segments: SegmentDefinition[], logger?: Logger) => {
		const mockFileHandler = new MockFileHandler();
		return new Assembler(fakeCPU, mockFileHandler, {
			segments,
			logger,
			log: { pass1Enabled: true, pass2Enabled: true },
		});
	};

	it("should align the PC to the next boundary", () => {
		const segments = [{ name: "CODE", start: 0x1001, size: 0, resizable: true }];
		const assembler = createAssembler(segments);
		const source = `
      .org $1001
      .align 4
      .byte $FF
    `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		// const finalPC = assembler.currentPC;

		expect(machineCode).toEqual([0, 0, 0, 0xff]);
		// expect(finalPC).toBe(0x1005);
	});

	it("should align with a custom fill value", () => {
		const segments = [{ name: "CODE", start: 0x1001, size: 0, resizable: true }];
		const assembler = createAssembler(segments);
		const source = `
      .org $1001
      .align 4, $AB
      .byte $FF
    `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		// const finalPC = assembler.currentPC;

		expect(machineCode).toEqual([0xab, 0xab, 0xab, 0xff]);
		// expect(finalPC).toBe(0x1005);
	});

	it("should not add padding if already aligned", () => {
		const segments = [{ name: "CODE", start: 0x1004, size: 0, resizable: true }];
		const assembler = createAssembler(segments);
		const source = `
      .org $1004
      .align 4
      .byte $FF
    `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		// const finalPC = assembler.currentPC;

		expect(machineCode).toEqual([0xff]);
		// expect(finalPC).toBe(0x1005);
	});

	it("should handle expressions for boundary and fill value", () => {
		const segments = [{ name: "CODE", start: 0x1001, size: 0, resizable: true }];
		const assembler = createAssembler(segments);
		const source = `
      .let boundary = 8
      .let fill = $CC
      .org $1001
      .align boundary, fill
      .byte $FF
    `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		// const finalPC = assembler.currentPC;

		// from 1001 to 1008 is 7 bytes
		expect(machineCode).toEqual([0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xcc, 0xff]);
		// expect(finalPC).toBe(0x1009);
	});

	it.each([
		[".align 3", "3"],
		[".align 6", "6"],
		[".align 0", "0"],
		[".align -4", "-4"],
		[".align boundary\nboundary = 12", "12"],
	])("should throw on a boundary that isn't a power of two: %j", (source, value) => {
		const logger = new Logger({ sink: new MemorySink(), enabled: true });
		const segments = [{ name: "CODE", start: 0x1001, size: 0, resizable: true }];
		const assembler = createAssembler(segments, logger);
		expect(() => assembler.assemble(`.org $1001\n${source}`)).toThrow(
			expect.objectContaining({
				message: `.ALIGN boundary: ${value} is not a power of two (1, 2, 4, 8, ...).`,
				location: expect.objectContaining({ line: 2 }),
			}),
		);
	});

	it("should accept 1 and a boundary defined later", () => {
		const logger = new Logger({ sink: new MemorySink(), enabled: true });
		const segments = [{ name: "CODE", start: 0x1001, size: 0, resizable: true }];
		const assembler = createAssembler(segments, logger);
		assembler.assemble(".org $1001\n.align 1\n.db 1\n.align boundary, $EA\n.db 2\nboundary = 4");
		expect(assembler.link()).toEqual([1, 0xea, 0xea, 2]);
	});

	it.each([".align [4,8][0], $EA", ".align .iif(1,4,8), $EA"])("should only split %s at its top-level comma", (directive) => {
		const segments = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];
		const assembler = createAssembler(segments);
		const source = `
			.db 1
			${directive}
			.db 2
		`;
		assembler.assemble(source);
		expect(assembler.link()).toEqual([1, 0xea, 0xea, 0xea, 2]);
	});

	it("should throw if the boundary can't be evaluated", () => {
		const logger = new Logger({ sink: new MemorySink(), enabled: true });
		const segments = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];
		const assembler = createAssembler(segments, logger);
		expect(() => assembler.assemble(".align undefinedSym")).toThrow("Undefined symbol 'UNDEFINEDSYM'");
	});

	it("should throw if the fill value can't be evaluated", () => {
		const logger = new Logger({ sink: new MemorySink(), enabled: true });
		const segments = [{ name: "CODE", start: 0x1001, size: 0, resizable: true }];
		const assembler = createAssembler(segments, logger);
		expect(() => assembler.assemble(".org $1001\n.align 4, undefinedSym")).toThrow("Undefined symbol 'UNDEFINEDSYM'");
	});
});
