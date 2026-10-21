import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { FileHandler } from "../assembler/polyasm.types";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { CPUHandler } from "../cpu/cpuhandler.interface";

describe("Assembler reuse", () => {
	const files: Record<string, string> = {};
	const fileHandler: FileHandler = {
		fullpath: "",
		filename: "",
		readSourceFile(filename: string) {
			this.fullpath = filename;
			this.filename = filename;
			return files[filename] ?? "";
		},
		readBinaryFile: () => [],
	};
	const createAssembler = (cpu: CPUHandler = new Cpu6502Handler()) =>
		new Assembler(cpu, fileHandler, { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
	const assemble = (assembler: Assembler, source: string) => {
		assembler.assemble(source);
		return assembler.link();
	};

	it("should assemble the same source twice", () => {
		files["inc.asm"] = ".db 3";
		const source = `
			.segment DATA { start: $2000, size: 1 }
			lbl: .db 1
			.include "inc.asm"
		`;
		const assembler = createAssembler();
		const first = assemble(assembler, source);
		expect(assemble(assembler, source)).toEqual(first);
	});

	it("should not keep the bytes of a previous call", () => {
		const assembler = createAssembler();
		assemble(assembler, ".db 1, 2, 3");
		expect(assemble(assembler, ".db 9")).toEqual([9]);
	});

	it("should not keep the symbols, macros or CPU of a previous call", () => {
		const assembler = createAssembler();
		assembler.assemble('x = 7\n.macro m\n.db 5\n.end\n.cpu "65C02"');
		expect(() => assembler.assemble(".db x")).toThrow("Undefined symbol 'X'");
		expect(() => assembler.assemble(" stz $10")).toThrow(); // back to the 6502
		assembler.assemble(".macro m\n.db 6\n.end\n m"); // no "redefined" error
		expect(assembler.link()).toEqual([6]);
	});

	it("should re-read included files", () => {
		const assembler = createAssembler();
		files["inc.asm"] = ".db 1";
		assemble(assembler, '.include "inc.asm"');
		files["inc.asm"] = ".db 2";
		expect(assemble(assembler, '.include "inc.asm"')).toEqual([2]);
	});

	it("should keep setup done before the first call", () => {
		const assembler = createAssembler(new Cpu65C02Handler());
		assembler.symbolTable.defineConstant("PRESET", 4, { filename: "", line: 0, column: 0 });
		expect(assemble(assembler, ".db PRESET")).toEqual([4]);
	});
});
