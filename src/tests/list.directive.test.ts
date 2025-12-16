import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
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
	getPCSize: () => 8,
};

describe(".LIST Directive", () => {
	it("should suppress log output when disabled and re-enable it", () => {
		const sink = new MemorySink();
		const logger = new Logger({ sink, enabled: true });
		const assembler = new Assembler(fakeCPU, new MockFileHandler(), { logger, log: { pass1Enabled: true, pass2Enabled: true } });

		const source = `
			Start: .DB 1 ; This should log
			.LIST OFF
			MyLabel: .DB 1 ; This should NOT log
			.LIST ON
			AnotherLabel: .DB 2 ; This should log again
		`;

		assembler.assemble(source);

		expect(sink.logs.filter((l) => l.match("Start:")).length).toEqual(2);
		expect(sink.logs.filter((l) => l.match("MyLabel:")).length).toEqual(0);
		expect(sink.logs.filter((l) => l.match("AnotherLabel:")).length).toEqual(2);
	});
});
