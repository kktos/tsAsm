import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { FileHandler } from "../assembler/polyasm.types";
import { Logger } from "../helpers/logger.class";
import type { LogSink } from "../helpers/logsink.interface";

class MemorySink implements LogSink {
	public logs: string[] = [];
	public warnings: string[] = [];
	public errors: string[] = [];

	log(message: unknown): void {
		this.logs.push(String(message));
	}
	warn(message: unknown): void {
		this.warnings.push(String(message));
	}
	error(message: unknown): void {
		this.errors.push(String(message));
	}
}

class MockFileHandler implements FileHandler {
	fullpath = "";
	readSourceFile(filename: string): string {
		throw new Error(`Mock file not found: "${filename}"`);
	}

	readBinaryFile(filename: string): number[] {
		throw new Error(`Mock bin file not found: ${filename}`);
	}
}

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
