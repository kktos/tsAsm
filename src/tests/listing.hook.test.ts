import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { ListedLine } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** What `onListing` gets assembling `source`, in short: `line| text`, its spaces squeezed; `-` before the first statement. */
function listed(source: string, logger?: Logger): string[] {
	const lines: ListedLine[] = [];
	const silent = new Logger({ sink: new MemorySink(), enabled: false });
	const log = { pass2Enabled: logger !== undefined };
	new Assembler(new Cpu6502Handler(), new MockFileHandler(), { logger: logger ?? silent, log, onListing: (line) => lines.push(line) }).assemble(source);
	return lines.map(({ text, site }) => `${site?.location.line ?? "-"}| ${text.trim().replace(/\s+/g, " ")}`);
}

describe("onListing", () => {
	it("tells pass 2's listing lines, each with its statement's line, the logger disabled", () => {
		expect(
			listed(`
	.org $1000
count = 3
start:	lda #count
	.db 2, 3
`),
		).toEqual(["-| .set namespace: global", "3| COUNT = $03", "4| 1000 start:", "4| 1000: A9 03 LDA #COUNT", "5| 1002: 02 03 .db $02, $03"]);
	});

	it("ties a macro body's lines to the body, its call to the call", () => {
		const lines = listed(`
.macro clear addr
	lda #0
	sta addr
.end
	clear $10
`);
		expect(lines).toEqual(["-| .set namespace: global", "6| clear(16)", "3| 1000: A9 00 LDA #$00", "4| 1002: 85 10 STA ADDR"]);
	});

	it("ties a loop's header to it, and a folded loop's line to its header", () => {
		const loop = `
	.org $1000
.repeat 2
	.db 1
.end
`;
		expect(listed(loop)).toEqual(["-| .set namespace: global", "3| .repeat $02", "4| 1000: 01 .db $01", "4| 1001: 01 .db $01"]);
		expect(listed(`\t.option listing.data "fold"${loop}`)).toContain("3| 1000: 01 01 .repeat $02");
		expect(listed(`\t.option listing.data "fold"${loop.replace(".db 1", ".db 1\n\tnop")}`)).toEqual([
			"-| .set namespace: global",
			'1| .option listing.data "fold"',
			"3| .repeat $02",
			"4| 1000: 01 .db $01",
			"5| 1001: EA NOP",
			"4| 1002: 01 .db $01",
			"5| 1003: EA NOP",
		]);
	});

	it("leaves the logger's listing as it was", () => {
		const sink = new MemorySink();
		const source = `
	.option listing.data "fold"
.repeat 2
	.db 1
.end
`;
		listed(source, new Logger({ sink, enabled: true }));
		const withHook = sink.logs.slice();
		const without = new MemorySink();
		new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
			logger: new Logger({ sink: without, enabled: true }),
			log: { pass2Enabled: true },
		}).assemble(source);
		expect(withHook).toEqual(without.logs);
		expect(withHook.filter((line) => line.endsWith(".repeat $02"))).toHaveLength(1);
	});
});
