import { describe, expect, it } from "vitest";
import type { Options } from "../assembler/options";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** Where the listing writes an instruction, after its address and bytes. */
const TEXT_COLUMN = 50;

/** The instructions of the pass 2 listing, as the listing writes them. */
function listInstructions(source: string, options?: Options): string[] {
	const sink = new MemorySink();
	const assembler = new Assembler(new Cpu65C02Handler(), new MockFileHandler(), {
		logger: new Logger({ sink, enabled: true }),
		segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		log: { pass2Enabled: true },
		options,
	});
	assembler.assemble(source);
	return sink.logs.filter((line) => /^[0-9A-F]{4}: [0-9A-F]{2} /.test(line)).map((line) => line.slice(TEXT_COLUMN).trimEnd());
}

describe(".option listing.case", () => {
	const source = `
		lda #1
		Sta $20
		NOP
	`;

	it("lists the mnemonics in upper case by default", () => {
		expect(listInstructions(source)).toEqual(["LDA #$01", "STA $20", "NOP"]);
	});

	it.each([
		["upper", ["LDA #$01", "STA $20", "NOP"]],
		["lower", ["lda #$01", "sta $20", "nop"]],
		["source", ["lda #$01", "Sta $20", "NOP"]],
	])("lists the mnemonics with listing.case %s", (listingCase, expected) => {
		const withOption = `
			.option listing.case "${listingCase}"
			${source}
		`;
		expect(listInstructions(withOption)).toEqual(expected);
		expect(listInstructions(source, { "listing.case": listingCase })).toEqual(expected);
	});

	it("takes effect from the next line on, and pass 2 starts again with the default", () => {
		const listing = listInstructions(`
			lda #1
			.option listing.case "lower"
			lda #2
		`);
		expect(listing).toEqual(["LDA #$01", "lda #$02"]);
	});

	it("keeps a mnemonic suffix as written with source", () => {
		const listing = listInstructions(`
			.option listing.case "source"
			Lda.W $20
		`);
		expect(listing).toEqual(["Lda.W $20"]);
	});

	it("rejects another value", () => {
		expect(() => listInstructions(`.option listing.case "mixed"`)).toThrow(
			expect.objectContaining({ message: "'listing.case' must be one of 'upper', 'lower', 'source'." }),
		);
		expect(() => listInstructions("nop", { "listing.case": "Upper" })).toThrow("'listing.case' must be one of 'upper', 'lower', 'source'.");
	});
});
