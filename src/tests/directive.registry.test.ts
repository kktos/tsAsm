import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { Linker } from "../linker/linker.class";
import { MockFileHandler } from "./mockfilehandler.class";

// Block and raw directives belong to each parser: the assembler's don't change how a link script is read, and the linker's don't change how a source is read.
describe("Directives registered per parser", () => {
	const assemble = (source: string) => {
		const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
		assembler.assemble(source);
		return assembler.link();
	};
	const link = (script: string) => new Linker(0).link(script, undefined, new Logger({ sink: new MemorySink() })).data;

	it("should not read the linker's .SECTION as a block in a source", () => {
		link(`
			.OUTPUT "x"
			.BYTE 1
		`);
		const source = `
			.IF 0
			.SECTION foo
			.END
			nop
		`;
		// Read as a block, .SECTION would take the .END: the .IF would miss its own.
		expect(() => assemble(source)).toThrow("Syntax error - Unexpected directive 'SECTION'");
	});

	it("should not read the assembler's .DEFINE as raw in a link script", () => {
		assemble("nop");
		const script = `
			.OUTPUT "x"
			.IF 0
			.DEFINE foo
			.END
			.BYTE 6
		`;
		// Read as raw, .DEFINE would take the .END: the .IF would miss its own.
		expect(() => link(script)).toThrow("Syntax error - Unexpected directive 'DEFINE'");
	});

	it("should not read .SECTION as a block in a link script", () => {
		const script = `
			.OUTPUT "x" FIXED 4
			.IF 1
			.SECTION S AT 1
			.BYTE 5
			.END
			.BYTE 6
		`;
		expect(link(script)).toEqual([0, 5, 6, 0]);
	});
});
