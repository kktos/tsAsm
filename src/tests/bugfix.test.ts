import { beforeEach, describe, expect, it, vi } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { hexDump } from "../utils/hexdump.util";
import { MockFileHandler } from "./mockfilehandler.class";

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("Bug Fixes", () => {
	let assembler: Assembler;
	let cpu65C02: Cpu65C02Handler;
	let mockFileHandler: MockFileHandler;
	let sink: MemorySink;

	beforeEach(() => {
		sink = new MemorySink();
		const logger = new Logger({ sink, enabled: true });
		cpu65C02 = new Cpu65C02Handler();
		mockFileHandler = new MockFileHandler();
		assembler = new Assembler(cpu65C02, mockFileHandler, { logger, segments: DEFAULT_SEGMENTS, log: { pass1Enabled: true, pass2Enabled: true } });
	});

	it("should access forward references correctly in function - clearScreen bug", () => {
		const includedCode = `
			.namespace utils
			.function clearScreen {
					stz yPos
			:		jsr $2000
					inc yPos
					ldx yPos
					cpx #$b7
					bne :-
					rts
			yPos	.db 0

					.echo "yPos = "+.hex(yPos)
			}
			`;
		const source = `
				.INCLUDE "included.asm"
			`;

		const mockReadSource = vi.fn(function (this: MockFileHandler, filename: string): string {
			this.fullpath = filename;
			return includedCode;
		});

		vi.spyOn(mockFileHandler, "readSourceFile").mockImplementation(mockReadSource);

		assembler.assemble(source);

		expect(sink.logs.filter((l) => l === "yPos = $1011").at(1)).toEqual("yPos = $1011");

		const machineCode = assembler.link();
		expect(hexDump(0x1000, machineCode, { hasText: false })).toEqual("1000:  9C 11 10 20 00 20 EE 11 10 AE 11 10 E0 B7 D0 F3\n1010:  60 00");
	});

	it("should put a byte with 'A' | $80 - variables.asm bug", () => {
		const source = `
				.dw $1000, $2000
				.db "A" | $80
				.db "A"+"B"
			`;

		assembler.assemble(source);

		const machineCode = assembler.link();
		expect(hexDump(0x1000, machineCode, { hasText: false })).toEqual("1000:  00 10 00 20 C1 41 42");
	});

	it("should reserve the same amount of bytes between passes - animConanJump bug", () => {
		const src = `
				; testing null on left and right of the expr eval
				lda caption + 2 ; caption, as a forward ref, will be null on 1st pass
				lda 2 + caption ; caption, as a forward ref, will be null on 1st pass

				caption:
					.db "hello",0
				end:
			`;
		assembler.assemble(src);

		const logs = sink.logs;

		expect(logs.filter((l) => l.startsWith("1000:"))[0]).toContain("1000: 00 00 00");
		expect(logs.filter((l) => l.startsWith("1003:"))[0]).toContain("1003: 00 00 00");
	});
});
