import { describe, expect, it } from "vitest";
import type { Options } from "../assembler/options";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** The pass 2 listing, its spaces collapsed, without the pass banners and the lines every listing has. */
function listing(source: string, options?: Options, binaryFile: number[] = []): string[] {
	const sink = new MemorySink();
	const fileHandler = new MockFileHandler();
	fileHandler.readBinaryFile = () => binaryFile;
	const assembler = new Assembler(new Cpu65C02Handler(), fileHandler, {
		logger: new Logger({ sink, enabled: true }),
		segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		log: { pass2Enabled: true },
		options,
	});
	assembler.assemble(source);
	return sink.logs
		.map((line) => String(line))
		.filter((line) => !line.startsWith("\n") && !line.includes(".set namespace") && !line.includes(".option"))
		.map((line) => line.replace(/\s+/g, " ").trim());
}

const LONG_DB = ".db 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18";
const LONG_DB_TEXT = ".db $01, $02, $03, $04, $05, $06, $07, $08, $09, $0A, $0B, $0C, $0D, $0E, $0F, $10, $11, $12";

describe(".option listing.data", () => {
	describe("expand, the default", () => {
		it("lists every byte of the data, 8 per line", () => {
			expect(listing(LONG_DB)).toEqual([`1000: 01 02 03 04 05 06 07 08 ${LONG_DB_TEXT}`, "1008: 09 0A 0B 0C 0D 0E 0F 10", "1010: 11 12"]);
		});

		it("lists the bytes of a .hex block, where they start", () => {
			const source = `
				.hex
					00 11 22 33 44 55 66 77
					88 99
				.end
			`;
			expect(listing(source)).toEqual(["1000: 00 11 22 33 44 55 66 77 .hex <10 bytes>", "1008: 88 99"]);
		});

		it("lists the bytes of an .incbin, where they start", () => {
			const source = `
				nop
				.incbin "data.bin"
			`;
			const bytes = [1, 2, 3, 4, 5, 6, 7, 8, 9];
			expect(listing(source, {}, bytes)).toEqual(["1000: EA NOP", '1001: 01 02 03 04 05 06 07 08 .incbin "data.bin"', "1009: 09"]);
		});

		it("lists a loop iteration by iteration, after its header", () => {
			const source = `
				.repeat 2 AS i
				.db i
				.end
				.for x of [$10, (2 + 3) * 4] AS n FROM 0
				.db x
				.end
			`;
			expect(listing(source)).toEqual([
				".repeat $02 AS i",
				"1000: 01 .db $01",
				"1001: 02 .db $02",
				".for x of [$10, ($02 + $03) * $04] AS n FROM $00",
				"1002: 10 .db $10",
				"1003: 14 .db $14",
			]);
		});
	});

	describe("fold", () => {
		it("lists the first 8 bytes of the data, a … when more follow, and its text cut", () => {
			const source = `
				.db 1, 2
				${LONG_DB}
				.text "Hello, world!"
			`;
			expect(listing(source, { "listing.data": "fold" })).toEqual([
				"1000: 01 02 .db $01, $02",
				"1002: 01 02 03 04 05 06 07 08 … .db $01, $02, $03, $04, $05, $06, $07, $08, $09…",
				'1014: 48 65 6C 6C 6F 2C 20 77 Hello, w… .text "Hello, world!"',
			]);
		});

		it("folds .hex, .fill and .incbin", () => {
			const source = `
				.hex 00 11 22 33 44 55 66 77 88
				.fill 10, $EA
				.incbin "data.bin"
			`;
			expect(listing(source, { "listing.data": "fold" }, [1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([
				"1000: 00 11 22 33 44 55 66 77 … .hex <9 bytes>",
				"1009: EA EA EA EA EA EA EA EA … .fill $0A, $EA",
				'1013: 01 02 03 04 05 06 07 08 … .incbin "data.bin"',
			]);
		});

		it("doesn't fold an instruction", () => {
			const source = `
				.option listing.data "fold"
				lda #1
			`;
			expect(listing(source)).toEqual(["1000: A9 01 LDA #$01"]);
		});

		it("lists a loop of data as one data statement, its header as the text", () => {
			const source = `
				.repeat 20 AS idx FROM 0
				.db (idx % 16) * 16
				.end
				.for x of [1, 2, 3] AS i
				.db x, i
				.end
			`;
			expect(listing(source, { "listing.data": "fold" })).toEqual([
				"1000: 00 10 20 30 40 50 60 70 … .repeat $14 AS idx FROM $00",
				"1014: 01 00 02 01 03 02 .for x of [$01, $02, $03] AS i",
			]);
		});

		it("lists nested loops of data as one", () => {
			const source = `
				.repeat 2 AS row
				.repeat 3
				.db row
				.end
				.end
			`;
			expect(listing(source, { "listing.data": "fold" })).toEqual(["1000: 01 01 01 02 02 02 .repeat $02 AS row"]);
		});

		it("lists a loop that does more than data line by line, its data folded", () => {
			const source = `
				.repeat 2
				lda #1
				.db 1, 2, 3, 4, 5, 6, 7, 8, 9
				.end
				.for x of [1, 2]
				last = x
				.db x
				.end
				.repeat 2 AS i
				.log "i = ", i
				.db i
				.end
			`;
			expect(listing(source, { "listing.data": "fold" })).toEqual([
				".repeat $02",
				"1000: A9 01 LDA #$01",
				"1002: 01 02 03 04 05 06 07 08 … .db $01, $02, $03, $04, $05, $06, $07, $08, $09",
				"100B: A9 01 LDA #$01",
				"100D: 01 02 03 04 05 06 07 08 … .db $01, $02, $03, $04, $05, $06, $07, $08, $09",
				".for x of [$01, $02]",
				"LAST = $01",
				"1016: 01 .db $01",
				"LAST = $02",
				"1017: 02 .db $02",
				".repeat $02 AS i",
				"i = 1",
				"1018: 01 .db $01",
				"i = 2",
				"1019: 02 .db $02",
			]);
		});

		it.each(["expand", "fold"])("lists an empty loop as its header, with %s", (listingData) => {
			const source = `
				.repeat 0
				nop
				.end
				.for x of []
				.db x
				.end
			`;
			expect(listing(source, { "listing.data": listingData })).toEqual([".repeat $00", ".for x of []"]);
		});

		it("lists what a loop ran up to an error", () => {
			const sink = new MemorySink();
			const assembler = new Assembler(new Cpu65C02Handler(), new MockFileHandler(), {
				logger: new Logger({ sink, enabled: true }),
				segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
				log: { pass2Enabled: true },
				options: { "listing.data": "fold" },
			});
			const source = `
				.repeat 3 AS i
				.db i * 150
				.end
			`;
			// 300 doesn't fit in a byte: pass 2 stops there
			expect(() => assembler.assemble(source)).toThrow("300");
			const logs = sink.logs.map((line) => String(line).replace(/\s+/g, " ").trim());
			expect(logs.slice(-1)).toEqual(["1000: 96 .db $96"]);
		});

		it("takes effect from the next line on", () => {
			const source = `
				${LONG_DB}
				.option listing.data "fold"
				${LONG_DB}
				.option listing.data "expand"
				${LONG_DB}
			`;
			expect(listing(source)).toEqual([
				`1000: 01 02 03 04 05 06 07 08 ${LONG_DB_TEXT}`,
				"1008: 09 0A 0B 0C 0D 0E 0F 10",
				"1010: 11 12",
				"1012: 01 02 03 04 05 06 07 08 … .db $01, $02, $03, $04, $05, $06, $07, $08, $09…",
				`1024: 01 02 03 04 05 06 07 08 ${LONG_DB_TEXT}`,
				"102C: 09 0A 0B 0C 0D 0E 0F 10",
				"1034: 11 12",
			]);
		});
	});

	it("rejects another value", () => {
		expect(() => listing(`.option listing.data "compact"`)).toThrow(
			expect.objectContaining({ message: "'listing.data' must be one of 'expand', 'fold'." }),
		);
		expect(() => listing("nop", { "listing.data": "Fold" })).toThrow("'listing.data' must be one of 'expand', 'fold'.");
	});
});
