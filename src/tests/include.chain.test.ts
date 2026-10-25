import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { FileHandler } from "../assembler/polyasm.types";
import { NodeFileHandler } from "../cli/file";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import type { AsmError } from "../utils/error.utils";

describe("Include chains in errors", () => {
	// Paths are resolved from the including file, as the CLI does.
	const makeAssembler = (files: Record<string, string>) => {
		const fileHandler: FileHandler = {
			fullpath: "main.asm",
			filename: "main.asm",
			readSourceFile(filename: string, from?: string) {
				this.fullpath = from ? posix.join(posix.dirname(from), filename) : filename;
				this.filename = posix.basename(filename);
				const source = files[this.fullpath];
				if (source === undefined) throw new Error(`no file ${this.fullpath}`);
				return source;
			},
			readBinaryFile: () => [],
		};
		const sink = new MemorySink();
		const assembler = new Assembler(new Cpu6502Handler(), fileHandler, {
			logger: new Logger({ sink, enabled: true }),
			segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
			rawDataProcessors: { default: "text", map: new Map([["text", (blockContent: string) => blockContent]]) },
		});
		return { assembler, sink };
	};

	const errorOf = (source: string, files: Record<string, string>) => {
		try {
			makeAssembler(files).assembler.assemble(source);
		} catch (e) {
			return (e as AsmError).format();
		}
		throw new Error("expected the assembly to fail");
	};

	it("should say how both definitions of a macro were included", () => {
		const files = {
			"includes/defsprite.macro.asm": "\t.macro defsprite w, h {\n\t\t.db w, h\n\t}\n",
			"modules/spritelib/spritelib.asm": '\t.include "../../includes/defsprite.macro.asm"\nspr_init:\n\trts\n',
			"levels/level1/level1.asm": '\tnop\n\t.include "../../includes/defsprite.macro.asm"\n',
		};
		const source = '\t.include "modules/spritelib/spritelib.asm"\n\t.include "levels/level1/level1.asm"\n';
		expect(errorOf(source, files)).toBe(
			[
				"includes/defsprite.macro.asm:1:2: error: Macro 'defsprite' redefined: a macro can only be defined once.",
				"    1 | \t.macro defsprite w, h {",
				"      | \t^",
				"  included from levels/level1/level1.asm:2:2",
				"  included from main.asm:2:2",
				"includes/defsprite.macro.asm:1:3: note: first defined here",
				"  included from modules/spritelib/spritelib.asm:1:2",
				"  included from main.asm:1:2",
			].join("\n"),
		);
	});

	it("should say how both definitions of a symbol were included", () => {
		const files = { "consts.asm": "count:\n\tnop\n", "lib/lib.asm": '\t.include "../consts.asm"\n' };
		expect(errorOf('count:\n\t.include "lib/lib.asm"\n', files)).toBe(
			[
				"consts.asm:1:1: error: Symbol 'COUNT' redefined.",
				"    1 | count:",
				"      | ^",
				"  included from lib/lib.asm:1:2",
				"  included from main.asm:2:2",
				"main.asm:1:1: note: first defined here",
			].join("\n"),
		);
	});

	it("should say how both definitions of a .define symbol were included", () => {
		const files = {
			"defs.asm": `	.define x
	abc
	.end
`,
			"lib/lib.asm": '\t.include "../defs.asm"\n',
		};
		const source = `	.include "defs.asm"
	.include "lib/lib.asm"
`;
		expect(errorOf(source, files)).toBe(
			[
				"defs.asm:1:2: error: Symbol 'X' redefined.",
				"    1 | \t.define x",
				"      | \t^",
				"  included from lib/lib.asm:1:2",
				"  included from main.asm:2:2",
				"defs.asm:1:3: note: first defined here",
				"  included from main.asm:1:2",
			].join("\n"),
		);
	});

	it("should give the include chain of any error in an included file", () => {
		const files = { "a.asm": '\tnop\n\t.include "sub/b.asm"\n', "sub/b.asm": "\tnop\n\t.bogus 1\n" };
		expect(errorOf('\tnop\n\t.include "a.asm"\n', files).split("\n").slice(-2)).toEqual(["  included from a.asm:2:2", "  included from main.asm:2:2"]);
	});

	it("should give no include chain to an error in the main file, after an include", () => {
		expect(errorOf('\t.include "a.asm"\n\t.bogus 1\n', { "a.asm": "\tnop\n" })).not.toContain("included from");
	});

	it("should give the include chain of the outermost macro call", () => {
		const files = {
			"macros.asm": "\t.macro m\n\t\t.db missing\n\t.end\n",
			"level.asm": "\tnop\n\tm\n",
		};
		// pass 2: the macro is defined in macros.asm, called in level.asm, which main.asm includes
		expect(errorOf('\t.include "macros.asm"\n\t.include "level.asm"\n', files).split("\n").slice(-2)).toEqual([
			"  in macro m, called at level.asm:2:2",
			"  included from main.asm:2:2",
		]);
	});

	it("should give the include chain of a warning", () => {
		const { assembler, sink } = makeAssembler({ "lib.asm": '\t.warning "careful"\n' });
		assembler.assemble('\t.include "lib.asm"\n');
		expect(sink.warnings[0]?.split("\n").at(-1)).toBe("  included from main.asm:1:2");
	});
});

describe("CLI file handler", () => {
	it("should normalize the path of an included file", () => {
		const dir = mkdtempSync(join(tmpdir(), "tsasm-files-"));
		try {
			mkdirSync(join(dir, "includes"));
			writeFileSync(join(dir, "includes", "x.asm"), "nop\n");
			const fileHandler = new NodeFileHandler();
			fileHandler.basedir = `${dir}/`;
			expect(fileHandler.readSourceFile("../../includes/x.asm", "./modules/sprites/sprites.asm")).toBe("nop\n");
			expect(fileHandler.fullpath).toBe(join("includes", "x.asm"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
