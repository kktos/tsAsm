import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import type { CPUHandler } from "../cpu/cpuhandler.interface";
import { CpuRV32IHandler } from "../cpu/cpurv32i.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** The pass 2 listing, its spaces collapsed, without the pass banners and the lines every listing has. */
function listing(source: string, start = 0x1000, cpu: CPUHandler = new Cpu65C02Handler()): string[] {
	const sink = new MemorySink();
	const assembler = new Assembler(cpu, new MockFileHandler(), {
		logger: new Logger({ sink, enabled: true }),
		segments: [{ name: "CODE", start, size: 0, resizable: true }],
		log: { pass2Enabled: true },
	});
	assembler.assemble(source);
	return sink.logs
		.map((line) => String(line))
		.filter((line) => !line.startsWith("\n") && !line.includes(".set namespace"))
		.map((line) => line.replace(/\s+/g, " ").trim());
}

describe("Listing labels", () => {
	it("lists a named label with its colon, an anonymous or a local one as written", () => {
		const source = `
			start:
			:	nop
				bne :-
			:loop	dex
				bne :loop
		`;
		expect(listing(source)).toEqual(["1000 start:", "1000 :", "1000: EA NOP", "1001: D0 FD BNE :-", "1003 :loop", "1003: CA DEX", "1004: D0 FD BNE :LOOP"]);
	});
});

describe("Listing addresses", () => {
	it("writes an address under $100 on 4 digits", () => {
		const source = `
			start:
				lda #5
		`;
		expect(listing(source, 0x80)).toEqual(["0080 start:", "0080: A9 05 LDA #$05"]);
	});

	it("writes an address over $FFFF on 6 digits", () => {
		const source = `
			start:
				addi x1, x0, 5
		`;
		expect(listing(source, 0x123456, new CpuRV32IHandler())).toEqual(["123456 start:", "123456: 93 00 50 00 ADDI X1,X0,$05"]);
	});

	it("writes a number over $FFFF in an operand on 6 digits", () => {
		const source = `
				.dl $10000
		`;
		expect(listing(source, 0x10000, new CpuRV32IHandler())).toEqual(["010000: 00 00 01 00 .dl $010000"]);
	});

	it("writes an address over $FFFFFF on 8 digits", () => {
		const source = `
			start:
				addi x1, x0, 5
		`;
		expect(listing(source, 0x12345678, new CpuRV32IHandler())).toEqual(["12345678 start:", "12345678: 93 00 50 00 ADDI X1,X0,$05"]);
	});
});
