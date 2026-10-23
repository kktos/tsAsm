import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Linker listing", () => {
	const link = (linkerEnabled?: boolean) => {
		const sink = new MemorySink();
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
			logger: new Logger({ sink }),
			segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
			log: { linkerEnabled },
		});
		assembler.assemble("  nop");
		sink.logs.length = 0;
		expect(assembler.link()).toEqual([0xea]);
		return sink.logs;
	};

	it("should list each segment's place in the binary with log.linkerEnabled", () => {
		expect(link(true)).toEqual(["\n--- Linker ---", "- CODE offset: $00 addr: $1000 size: $01 len: $01"]);
	});

	it("should list nothing by default", () => {
		expect(link()).toEqual([]);
	});

	it("should leave the logger as it was", () => {
		const logger = new Logger({ sink: new MemorySink() });
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), { logger, log: { linkerEnabled: true } });
		assembler.assemble("  nop");
		logger.enabled = false;
		assembler.link();
		expect(logger.enabled).toBe(false);
	});
});
