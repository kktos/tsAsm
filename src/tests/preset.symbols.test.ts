import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { AssemblerOptions } from "../assembler/polyasm.types";
import { projectOptions } from "../cli/project";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { AsmError } from "../utils/error.utils";
import { MockFileHandler } from "./mockfilehandler.class";

const logger = () => new Logger({ sink: new MemorySink(), enabled: false });

/** An assembler given `symbols`, defined in `project.yaml`. */
function assembler(symbols: Record<string, unknown>, options: AssemblerOptions = {}) {
	return new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
		logger: logger(),
		segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		symbols,
		symbolSource: () => "project.yaml",
		...options,
	});
}

/** The bytes of `source`, assembled with `symbols`. */
function bytes(symbols: Record<string, unknown>, source: string) {
	const asm = assembler(symbols);
	asm.assemble(source);
	return [...asm.link()];
}

/** The error assembling `source` with `symbols`, or building the assembler, formatted. */
function errorOf(symbols: Record<string, unknown>, source = "") {
	try {
		assembler(symbols).assemble(source);
	} catch (e) {
		if (e instanceof AsmError) return e.format();
		throw e;
	}
	throw new Error("No error.");
}

describe("Symbols given to the assembler", () => {
	it("should be global constants the source reads, in any case", () => {
		expect(
			bytes(
				{ DISK_KB: 800, name: "AB" },
				`
	.dw disk_kb
	.db NAME
	.namespace gfx
	.dw DISK_KB
`,
			),
		).toEqual([0x20, 0x03, 0x41, 0x42, 0x20, 0x03]);
	});

	it("should take arrays and objects, and a boolean as 1 or 0", () => {
		expect(
			bytes(
				{ LIST: [1, 2], CFG: { size: 3, debug: true }, ON: true, OFF: false },
				`
	.db LIST[1], CFG.size, CFG.debug, ON, OFF
`,
			),
		).toEqual([0x02, 0x03, 0x01, 0x01, 0x00]);
	});

	it("should be defined from the start of both passes", () => {
		expect(
			bytes(
				{ DISK_KB: 140 },
				`
	.if .def(DISK_KB) && .def(global::DISK_KB)
	.db 1
	.end
`,
			),
		).toEqual([0x01]);
	});

	it("should be read by the linker script", () => {
		const asm = assembler({ DISK_KB: 800 });
		asm.assemble("	nop");
		expect(asm.linker.link(`.WRITE WORD .symbol("disk_kb") * 2`, undefined, logger()).data).toEqual([0x40, 0x06]);
	});

	it("should be kept when the assembler assembles again", () => {
		const asm = assembler({ DISK_KB: 800 });
		asm.assemble("	.dw DISK_KB");
		asm.assemble("	.dw DISK_KB");
		expect([...asm.link()]).toEqual([0x20, 0x03]);
	});

	it("should be in the symbol file, defined in the project file", () => {
		const asm = assembler({ DISK_KB: 800 });
		asm.assemble("	nop");
		expect(asm.symbolTable.getDict().global?.DISK_KB).toBe("const number = $0320 ;project.yaml");
	});

	it("should stop the source from defining them again", () => {
		expect(errorOf({ DISK_KB: 800 }, "DISK_KB = 140")).toBe(
			["1:9: error: Can't redefine constant 'DISK_KB'.", "    1 | DISK_KB = 140", "      |         ^", "project.yaml: note: defined here"].join("\n"),
		);
		expect(errorOf({ DISK_KB: 800 }, "disk_kb .equ 140")).toContain("error: Symbol 'DISK_KB' redefined.");
		expect(errorOf({ DISK_KB: 800 }, "disk_kb: nop")).toContain("error: Symbol 'DISK_KB' redefined.");
	});

	it("should stop a name given twice, in two cases", () => {
		expect(errorOf({ DISK_KB: 800, disk_kb: 140 })).toBe("project.yaml: error: Symbol 'DISK_KB' redefined.\nproject.yaml: note: first defined here");
	});

	it("should stop a name that isn't a global symbol's", () => {
		expect(errorOf({ "gfx::TILES": 1 })).toBe(
			"project.yaml: error: 'gfx::TILES' isn't a symbol name: a letter, then letters, digits or '_'. These symbols are in the global namespace.",
		);
		expect(errorOf({ "1ST": 1 })).toContain("error: '1ST' isn't a symbol name");
	});

	it("should stop a value that isn't a number, a string, an array or an object", () => {
		const needed = ": a number, a string, an array or an object is needed.";
		expect(errorOf({ DISK_KB: null })).toBe(`project.yaml: error: Symbol 'DISK_KB' has no value${needed}`);
		expect(errorOf({ DISK_KB: Number.NaN })).toBe(`project.yaml: error: Symbol 'DISK_KB' is NaN${needed}`);
		expect(errorOf({ DAY: new Date(0) })).toBe(`project.yaml: error: Symbol 'DAY' is a date${needed}`);
	});
});

describe("The project file's symbols", () => {
	it("should be defined in the project file", () => {
		const options = projectOptions({ input: { source: "main.asm", symbols: { DISK_KB: 800 } } }, logger(), "conan.yaml");
		expect(options.symbols).toEqual({ DISK_KB: 800 });
		expect(options.symbolSource?.("DISK_KB")).toBe("conan.yaml");
	});

	it("should be overridden by the command line's, in any case", () => {
		const conf = { input: { source: "main.asm", symbols: { DISK_KB: 800, VERSION: 2 } } };
		const options = projectOptions(conf, logger(), "conan.yaml", { disk_kb: 140, DEBUG: 1 });
		expect(options.symbols).toEqual({ VERSION: 2, disk_kb: 140, DEBUG: 1 });
		expect(options.symbolSource?.("disk_kb")).toBe("command line");
		expect(options.symbolSource?.("VERSION")).toBe("conan.yaml");
	});

	it("should be the command line's alone without input.symbols", () => {
		const options = projectOptions({ input: { source: "main.asm" } }, logger(), "conan.yaml", { DEBUG: 1 });
		expect(options.symbols).toEqual({ DEBUG: 1 });
		expect(projectOptions({ input: { source: "main.asm" } }, logger(), "conan.yaml").symbols).toBeUndefined();
	});
});
