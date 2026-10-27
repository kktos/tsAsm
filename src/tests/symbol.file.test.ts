import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** The symbol file's content: `getDict()` after assembling `source`. */
function symbolsOf(source: string) {
	const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
		segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		logger: new Logger({ sink: new MemorySink(), enabled: false }),
	});
	assembler.assemble(source);
	return assembler.symbolTable.getDict();
}

describe("Symbol file", () => {
	it("should name the default namespace global", () => {
		const dict = symbolsOf(`
SCREEN .equ $0400
`);
		expect(Object.keys(dict)).toEqual(["global"]);
		expect(dict.global?.SCREEN).toBe("number = $0400 ;:2:8");
	});

	it("should escape a string's value", () => {
		const dict = symbolsOf(`
msg = "he said \\"hi\\"\\n"
`);
		expect(dict.global?.MSG).toBe('string = "he said \\"hi\\"\\n" ;:2:5');
	});

	it("should key a namespace by its name followed by its metadata", () => {
		const dict = symbolsOf(`
.namespace gfx base=$2000, kind="screen"
w .equ 40
.end namespace
`);
		expect(Object.keys(dict)).toEqual(["global", "GFX [BASE=8192, KIND=screen]"]);
		expect(dict["GFX [BASE=8192, KIND=screen]"]?.W).toBe("number = $28 ;:3:3");
	});

	it("should name the default namespace global with its metadata", () => {
		const dict = symbolsOf(`
.namespace global kind="main"
SCREEN .equ $0400
`);
		expect(Object.keys(dict)).toEqual(["global [KIND=main]"]);
	});
});
