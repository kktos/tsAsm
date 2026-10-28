import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** The pass 2 listing, its spaces collapsed, without the pass banners and the lines every listing has. */
function listing(source: string): string[] {
	const sink = new MemorySink();
	const assembler = new Assembler(new Cpu65C02Handler(), new MockFileHandler(), {
		logger: new Logger({ sink, enabled: true }),
		segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
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
