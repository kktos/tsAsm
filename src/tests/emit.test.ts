import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { Emission, FileHandler } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";

/** What `onEmit` gets assembling `source` (`main.asm`), in short: `file:line address bytes`, then the calls and includes. */
function emissions(source: string, files: Record<string, string> = {}): string[] {
	const all: Emission[] = [];
	const fileHandler: FileHandler = {
		fullpath: "main.asm",
		filename: "main.asm",
		readSourceFile(filename, from) {
			this.fullpath = from ? posix.join(posix.dirname(from), filename) : filename;
			this.filename = posix.basename(filename);
			const text = files[this.fullpath];
			if (text === undefined) throw new Error(`no file ${this.fullpath}`);
			return text;
		},
		readBinaryFile() {
			return [];
		},
	};
	new Assembler(new Cpu6502Handler(), fileHandler, { onEmit: (emission) => all.push(emission) }).assemble(source);
	const where = ({ file, line }: { file?: string; line?: number | string }) => `${file}:${line}`;
	return all.map(({ site, address, bytes }) =>
		[where(site.location), String(address), bytes.map((byte) => byte.toString(16)).join(" "), ...site.includeStack.map(where)].join(" "),
	);
}

describe("onEmit", () => {
	it("tells each statement's address and bytes, once, in pass 2", () => {
		expect(
			emissions(`
	.org $1000
start:	lda #1
	.db 2, 3
	nop
`),
		).toEqual(["main.asm:3 4096 a9 1", "main.asm:4 4098 2 3", "main.asm:5 4100 ea"]);
	});

	it("locates a macro body's statement in the macro's file, with the call that led there", () => {
		expect(
			emissions(
				`
	.org $1000
	.include "macros.asm"
	clear
	clear
`,
				{ "macros.asm": ".macro clear\n\tlda #0\n.end\n" },
			),
		).toEqual(["macros.asm:2 4096 a9 0 main.asm:4", "macros.asm:2 4098 a9 0 main.asm:5"]);
	});

	it("tells each run of a loop's body", () => {
		expect(emissions("\t.org $1000\n\t.repeat 2\n\tnop\n\t.end\n")).toEqual(["main.asm:3 4096 ea", "main.asm:3 4097 ea"]);
	});
});
