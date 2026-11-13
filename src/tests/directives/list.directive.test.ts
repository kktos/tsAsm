import { describe, expect, it } from "vitest";
import { Assembler } from "../../assembler/polyasm";
import { Logger } from "../../helpers/logger.class";
import { MemorySink } from "../../helpers/memorysink.class";
import { MockFileHandler } from "../mockfilehandler.class";

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
	addressBits: 16,
};

describe(".LIST Directive", () => {
	it("should suppress log output when disabled and re-enable it", () => {
		const sink = new MemorySink();
		const logger = new Logger({ sink, enabled: true });
		const assembler = new Assembler(fakeCPU, new MockFileHandler(), {
			logger,
			log: { pass1Enabled: true, pass2Enabled: true },
		});

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

	describe(".LIST ON turns back on only the passes listed", () => {
		const source = `
			.LIST OFF
			Hidden: .DB 1
			.LIST ON
			Shown: .DB 2
		`;
		/** The lines of `source`'s labels in the listing, each with the pass it's in (0 before the first header), its spaces collapsed. */
		const listed = (enabled: boolean, log: { pass1Enabled?: boolean; pass2Enabled?: boolean }) => {
			const sink = new MemorySink();
			new Assembler(fakeCPU, new MockFileHandler(), { logger: new Logger({ sink, enabled }), log }).assemble(source);
			let pass = 0;
			return sink.logs.flatMap((line) => {
				if (line.includes("Starting Pass 1")) pass = 1;
				if (line.includes("Starting Pass 2")) pass = 2;
				return line.includes("Shown:") || line.includes("Hidden:") ? [`${pass} ${line.trim().replace(/\s+/g, " ")}`] : [];
			});
		};

		it("pass 2 only", () => {
			expect(listed(true, { pass2Enabled: true })).toEqual(["2 1001 Shown:"]);
		});

		it("pass 1 only", () => {
			expect(listed(true, { pass1Enabled: true })).toEqual(["1 1001 Shown:"]);
		});

		it("neither, the logger enabled or not", () => {
			expect(listed(true, {})).toEqual([]);
			expect(listed(false, { pass1Enabled: true, pass2Enabled: true })).toEqual([]);
		});
	});
});
