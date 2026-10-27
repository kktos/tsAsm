import { beforeEach, describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Cpu6809Handler } from "../cpu/cpu6809.class";
import type { CPUHandler } from "../cpu/cpuhandler.interface";
import { CpuRV32IHandler } from "../cpu/cpurv32i.class";
import { MockFileHandler } from "./mockfilehandler.class";

// A simple mock for the FileHandler so we don't need to interact with the filesystem.

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("CpuDirective", () => {
	let assembler: Assembler;
	let fileHandler: MockFileHandler;

	beforeEach(() => {
		fileHandler = new MockFileHandler();
		// The 6502 first: the source starts with it.
		assembler = new Assembler([new Cpu6502Handler(), new Cpu65C02Handler(), new Cpu6809Handler(), new CpuRV32IHandler()], fileHandler, {
			segments: DEFAULT_SEGMENTS,
		});
	});

	const cpuAfter = (source: string) => {
		assembler.assemble(source);
		return assembler.getCPUHandler().cpuType;
	};

	it('should switch the CPU handler from 6502 to 65C02 when .cpu "65C02" is used', () => {
		const source = `
			.cpu "65C02"
			NOP  ; A simple instruction to ensure assembly runs
		`;

		// 1. Check initial state
		expect(assembler.getCPUHandler()).toBeInstanceOf(Cpu6502Handler);

		// 2. Assemble the code
		assembler.assemble(source);

		// 3. Verify the handler was switched
		expect(assembler.getCPUHandler()).toBeInstanceOf(Cpu65C02Handler);
		expect(assembler.getCPUHandler().cpuType).toBe("65C02");
	});

	it("should correctly assemble a 65C02-specific instruction after switching", () => {
		const source = `
			.processor "65C02"
			STZ $44      ; STZ is a 65C02-only instruction (Opcode  for ZP)
		`;

		const segments = assembler.assemble(source);
		const codeSegment = segments.find((s) => s.name === "CODE");

		// Verify that the output bytes match the expected opcode and operand for STZ
		expect(codeSegment?.data).toEqual([0x64, 0x44]);
	});

	it("should throw an error if a 65C02-specific instruction is used with the default 6502 handler", () => {
		const source = `
			STZ $44      ; This should fail because the default CPU is 6502
		`;

		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: "Syntax error : NUMBER 68",
				location: { file: "", line: 2, column: 8 },
			}),
		);
	});

	describe("the CPU's name", () => {
		it("is a word alone, starting with a digit or not, in any case", () => {
			expect(cpuAfter(".cpu 65C02")).toBe("65C02");
			expect(cpuAfter(".cpu 65c02 ; comment")).toBe("65C02");
			expect(cpuAfter(".setcpu 6809")).toBe("6809");
			expect(cpuAfter(".processor rv32i")).toBe("RV32I");
		});

		it("is 6502, a bare number, too", () => {
			assembler = new Assembler([new Cpu65C02Handler(), new Cpu6502Handler()], fileHandler, { segments: DEFAULT_SEGMENTS });
			expect(cpuAfter(".cpu 6502")).toBe("6502");
		});

		it("can be a string expression", () => {
			expect(cpuAfter('.cpu "65C02"')).toBe("65C02");
			expect(
				cpuAfter(`
					CPU = "65" + "C02"
					.cpu (CPU)
				`),
			).toBe("65C02");
			expect(
				cpuAfter(`
					C02 = 1
					.cpu .iif(C02, "65C02", "6502")
				`),
			).toBe("65C02");
		});

		it("is read as a word in a skipped .if, a .repeat and a macro", () => {
			expect(
				cpuAfter(`
					.if 0
						.cpu 6809
					.end
					.repeat 2
						.cpu 65C02
					.end
				`),
			).toBe("65C02");
			expect(
				cpuAfter(`
					.macro to6809
						.cpu 6809
					.end
					to6809
				`),
			).toBe("6809");
		});

		it("is the word, even a symbol's name: a symbol's value needs parentheses", () => {
			const source = `
				CPU = "65C02"
				.cpu CPU
			`;
			expect(() => assembler.assemble(source)).toThrow("Unknown CPU name 'CPU': the CPUs are 6502, 65C02, 6809, RV32I.");
		});

		it("is an error when it's no CPU's name", () => {
			expect(() => assembler.assemble(".cpu 65816")).toThrow("Unknown CPU name '65816': the CPUs are 6502, 65C02, 6809, RV32I.");
			expect(() => assembler.assemble(".cpu 6502x")).toThrow("Unknown CPU name '6502x': the CPUs are 6502, 65C02, 6809, RV32I.");
		});
	});

	describe("the CPUs it's given", () => {
		const create = (cpus: CPUHandler | CPUHandler[], cpu?: string) => new Assembler(cpus, fileHandler, { segments: DEFAULT_SEGMENTS, cpu });

		it("are the only ones .cpu switches to, and the error lists them", () => {
			const cpu6502 = new Cpu6502Handler();
			const cpu65C02 = new Cpu65C02Handler();
			assembler = create([cpu6502, cpu65C02]);

			assembler.assemble(".cpu 65C02");
			expect(assembler.getCPUHandler()).toBe(cpu65C02);
			assembler.assemble(`
				.cpu 65C02
				.cpu 6502
			`);
			expect(assembler.getCPUHandler()).toBe(cpu6502);
			expect(() => assembler.assemble(".cpu 6809")).toThrow(
				expect.objectContaining({ message: "Unknown CPU name '6809': the CPUs are 6502, 65C02.", location: expect.objectContaining({ line: 1 }) }),
			);
		});

		it("is one: .cpu can only name it", () => {
			assembler = create(new Cpu6502Handler());
			expect(cpuAfter(".cpu 6502")).toBe("6502");
			expect(() => assembler.assemble(".cpu 65C02")).toThrow("Unknown CPU name '65C02': the CPUs are 6502.");
		});

		it("start with the first one, at each assemble()", () => {
			assembler = create([new Cpu65C02Handler(), new Cpu6502Handler()]);
			expect(assembler.getCPUHandler().cpuType).toBe("65C02");
			expect(cpuAfter(".cpu 6502")).toBe("6502");
			expect(cpuAfter("nop")).toBe("65C02");
		});

		it("start with the one the cpu option names, in any case, wherever it is", () => {
			assembler = create([new Cpu65C02Handler(), new Cpu6502Handler(), new Cpu6809Handler()], "6809");
			expect(assembler.getCPUHandler().cpuType).toBe("6809");
			expect(cpuAfter(".cpu 6502")).toBe("6502");
			expect(cpuAfter("nop")).toBe("6809");
			expect(create([new Cpu6502Handler(), new CpuRV32IHandler()], "rv32i").getCPUHandler().cpuType).toBe("RV32I");
		});

		it("start each pass with the first one, or the one the cpu option names", () => {
			const source = `
				stz $44
				.cpu 6502
				nop
			`;
			assembler = create([new Cpu65C02Handler(), new Cpu6502Handler()]);
			assembler.assemble(source);
			expect(assembler.link()).toEqual([0x64, 0x44, 0xea]);

			assembler = create([new Cpu6502Handler(), new Cpu65C02Handler()], "65C02");
			assembler.assemble(source);
			expect(assembler.link()).toEqual([0x64, 0x44, 0xea]);
		});

		it("must hold the one the cpu option names", () => {
			expect(() => create([new Cpu6502Handler(), new Cpu65C02Handler()], "6809")).toThrow("Unknown CPU name '6809': the CPUs are 6502, 65C02.");
		});

		it("can't be none, or two with the same name", () => {
			expect(() => create([])).toThrow("The assembler needs a CPU.");
			expect(() => create([new Cpu6502Handler(), new Cpu65C02Handler(), new Cpu6502Handler()])).toThrow("Two CPUs are named '6502'.");
		});
	});
});
