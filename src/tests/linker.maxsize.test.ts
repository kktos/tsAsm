import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { AssemblerOptions } from "../assembler/polyasm.types";
import { CpuRV32IHandler } from "../cpu/cpurv32i.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** An RV32I source with a segment at $FFF0 and one at $200000: a raw image of $1F0014 bytes, over the default 1 MB. */
function assembler(options: AssemblerOptions = {}) {
	const asm = new Assembler(new CpuRV32IHandler(), new MockFileHandler(), {
		logger: new Logger({ sink: new MemorySink(), enabled: false }),
		segments: [
			{ name: "LOW", start: 0xfff0, size: 0, resizable: true },
			{ name: "HIGH", start: 0x200000, size: 0, resizable: true },
		],
		...options,
	});
	asm.assemble(`
		.segment LOW
		addi x1, x0, 1
		.segment HIGH
		addi x1, x0, 2
	`);
	return asm;
}

describe("The linker's maxSize", () => {
	it("should stop a raw image over 1 MB by default", () => {
		expect(() => assembler().link()).toThrow(
			"The output would be $1F0014 bytes, from segment 'LOW' ($FFF0) to segment 'HIGH' ($200000): more than the linker's maxSize, $100000.",
		);
	});

	it("should take the maxSize of the options", () => {
		expect(assembler({ linker: { maxSize: 0x1000000 } }).link()).toHaveLength(0x1f0014);
	});

	it("should stop a maxSize over 16 MB", () => {
		expect(() => assembler({ linker: { maxSize: 0x2000000 } })).toThrow("The linker's maxSize, $2000000, isn't 1 to $1000000 (16 MB).");
	});
});
