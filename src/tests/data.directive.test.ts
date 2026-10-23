import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Cpu6809Handler } from "../cpu/cpu6809.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

// Minimal fake CPU handler
const fakeCPU = {
	cpuType: "6502" as const,
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

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("Data Directives", () => {
	const createAssembler = (segments: SegmentDefinition[] = DEFAULT_SEGMENTS) => {
		const mockFileHandler = new MockFileHandler();
		return new Assembler(fakeCPU, mockFileHandler, { segments });
	};

	it("should handle .DB with single and multiple numbers", () => {
		const assembler = createAssembler();
		const source = ".DB 10, 20, $30";
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([10, 20, 0x30]);
	});

	it("should handle .BYTE as an alias for .DB", () => {
		const assembler = createAssembler();
		const source = ".BYTE 10, 20, $30";
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([10, 20, 0x30]);
	});

	it("should handle .DW with little-endian encoding", () => {
		const assembler = createAssembler();
		const source = ".DW $1234, $5678";
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([0x34, 0x12, 0x78, 0x56]);
	});

	it("should handle .WORD as an alias for .DW", () => {
		const assembler = createAssembler();
		const source = ".WORD $1234, $5678";
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([0x34, 0x12, 0x78, 0x56]);
	});

	it("should handle .DL with little-endian encoding", () => {
		const assembler = createAssembler();
		const source = ".DL $12345678";
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([0x78, 0x56, 0x34, 0x12]);
	});

	it("should handle .LONG as an alias for .DL", () => {
		const assembler = createAssembler();
		const source = ".LONG $12345678";
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([0x78, 0x56, 0x34, 0x12]);
	});

	it("should handle a mix of numbers and strings", () => {
		const assembler = createAssembler();
		const source = `.DB "Hello", 13, 10`;
		assembler.assemble(source);
		const machineCode = assembler.link();
		const expected = "Hello".split("").map((c) => c.charCodeAt(0));
		expected.push(13, 10);
		expect(machineCode).toEqual(expected);
	});

	it("should handle expressions as values", () => {
		const assembler = createAssembler();
		const source = `
		.let val = 5
		.DB val * 2, val + 10
		`;
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([10, 15]);
	});

	it("should handle forward-referenced expressions in pass two", () => {
		const assembler = createAssembler();
		const source = `
		.DW target
		target: .DB 0
		`;
		assembler.assemble(source);
		const machineCode = assembler.link();
		// The segment starts at 0x1000. The .DW is at 0x1000. 'target' is at 0x1002.
		expect(machineCode).toEqual([0x02, 0x10, 0x00]);
	});

	it("should compute the data size in pass one and in pass two", () => {
		const sink = new MemorySink();
		const logger = new Logger({ sink, enabled: true });
		const assembler = new Assembler(new Cpu65C02Handler(), new MockFileHandler(), { logger, log: { pass1Enabled: true, pass2Enabled: true } });

		const source = `
				bra test
				.dw .label("test")
			test:
				rts
		`;
		assembler.assemble(source);

		// expect(sink.logs).toEqual(2);

		const machineCode = assembler.link();
		expect(machineCode).toEqual([0x80, 0x02, 0x04, 0x10, 0x60]);
	});

	describe("commas inside a value", () => {
		it.each([
			[".DB [1,2][1], 3", [2, 3]],
			[".DW [$1234,5][0], 6", [0x34, 0x12, 6, 0]],
			[".DB [[1,2],[3,4]][1][0]", [3]],
			['.TEXT ["ab","cd"][1], "x"', [0x63, 0x64, 0x78]],
			[".DB .iif(1,2,3), 4", [2, 4]],
			['.DB "(", 1', [0x28, 1]],
			['.DB "[", 1', [0x5b, 1]],
		])("should only split %s at its top-level commas", (source, expected) => {
			const assembler = createAssembler();
			assembler.assemble(source);
			expect(assembler.link()).toEqual(expected);
		});
	});

	describe("arrays and objects", () => {
		const ARRAY = "value: an array can't be emitted as is: index it to emit one of its elements.";
		const OBJECT = ".DB value: an object can't be emitted as is: use one of its fields.";
		const errorAt = (message: string, line: number, column: number) =>
			expect.objectContaining({ message, location: expect.objectContaining({ line, column }) });
		const createJsonAssembler = () => {
			const rawDataProcessors = { default: "JSON", map: new Map([["JSON", (block: string) => JSON.parse(block)]]) };
			return new Assembler(fakeCPU, new MockFileHandler(), { segments: DEFAULT_SEGMENTS, rawDataProcessors });
		};

		it.each([
			[".DB [1,2]", `.DB ${ARRAY}`, 5],
			[".DW 1, [1,2]", `.DW ${ARRAY}`, 8],
			['.DB .split("a b")', `.DB ${ARRAY}`, 5],
			[".DB []", `.DB ${ARRAY}`, 5],
		])("should throw on an array: %s", (source, message, column) => {
			expect(() => createAssembler().assemble(source)).toThrow(errorAt(message, 1, column));
		});

		it("should throw on an array symbol", () => {
			const source = `
				t = [1,2]
				.DL t
			`;
			expect(() => createAssembler().assemble(source)).toThrow(errorAt(`.DL ${ARRAY}`, 3, 9));
		});

		it("should throw on an array defined after the directive", () => {
			// t isn't known in pass 1, counted as one byte: pass 2 emitted nothing for it
			const source = `
				.DB t
				.DB 9
				t = [1,2]
			`;
			expect(() => createAssembler().assemble(source)).toThrow(errorAt(`.DB ${ARRAY}`, 2, 9));
		});

		it("should throw on an object", () => {
			const source = `
				.DEFINE p
				{ "x": 1 }
				.END
				.DB p
			`;
			expect(() => createJsonAssembler().assemble(source)).toThrow(errorAt(OBJECT, 5, 9));
		});

		it("should emit an indexed array or an object's field", () => {
			const assembler = createJsonAssembler();
			const source = `
				t = [2,3]
				.DEFINE p
				{ "x": 1 }
				.END
				.DB t[1], p.x
			`;
			assembler.assemble(source);
			expect(assembler.link()).toEqual([3, 1]);
		});
	});

	describe("value ranges", () => {
		const assemble = (source: string) => {
			const assembler = createAssembler();
			assembler.assemble(source);
			return assembler.link();
		};

		it("should accept signed and unsigned values at the limits", () => {
			expect(assemble(".DB 255, -128\n.DW $FFFF, -32768\n.DL $FFFFFFFF, -1")).toEqual([
				0xff, 0x80, 0xff, 0xff, 0x00, 0x80, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
			]);
		});

		it.each([
			[".DB 256", ".DB value: 256 doesn't fit in a byte (-128..255)."],
			[".DB -129", ".DB value: -129 doesn't fit in a byte (-128..255)."],
			[".DW $10000", ".DW value: 65536 doesn't fit in 2 bytes (-32768..65535)."],
			[".DL $100000000", ".DL value: 4294967296 doesn't fit in 4 bytes (-2147483648..4294967295)."],
			[".FILL 2, 256", ".FILL value: 256 doesn't fit in a byte (-128..255)."],
			[".DB 1\n.ALIGN 4, 256", ".ALIGN value: 256 doesn't fit in a byte (-128..255)."],
			['.DB "a€"', ".DB value: '€' (U+20AC) doesn't fit in a byte."],
			['.DW 1, "😀"', ".DW value: '😀' (U+1F600) doesn't fit in a byte."],
		])("should throw on an out-of-range value: %s", (source, message) => {
			expect(() => assemble(source)).toThrow(message);
		});
	});

	describe("byte order", () => {
		const assembleWith = (cpu: Cpu65C02Handler | Cpu6809Handler, source: string) => {
			const assembler = new Assembler(cpu, new MockFileHandler(), { segments: DEFAULT_SEGMENTS });
			assembler.assemble(source);
			return assembler.link();
		};

		it("should write .DW, .DL and the .PSTRL length big-endian on the 6809", () => {
			expect(assembleWith(new Cpu6809Handler(), '.DW $1234, -2\n.DL $12345678\n.PSTRL "ab"')).toEqual([
				0x12, 0x34, 0xff, 0xfe, 0x12, 0x34, 0x56, 0x78, 0x00, 0x02, 0x61, 0x62,
			]);
		});

		it("should write them little-endian on the 65C02", () => {
			expect(assembleWith(new Cpu65C02Handler(), '.DW $1234\n.DL $12345678\n.PSTRL "ab"')).toEqual([
				0x34, 0x12, 0x78, 0x56, 0x34, 0x12, 0x02, 0x00, 0x61, 0x62,
			]);
		});

		it("should follow the CPU selected with .CPU", () => {
			expect(assembleWith(new Cpu65C02Handler(), '.DW $1234\n.CPU "6809"\n.DW $1234\n.CPU "65C02"\n.DW $1234')).toEqual([0x34, 0x12, 0x12, 0x34, 0x34, 0x12]);
		});
	});
});
