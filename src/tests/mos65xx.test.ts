import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler, P65C02 } from "../cpu/cpu65c02.class";
import { Cpu6502Handler, P6502 } from "../cpu/cpu6502.class";
import { Mos65xxHandler } from "../cpu/mos65xx.class";
import { CMOS_ADDITIONS, NMOS } from "../cpu/mos65xx.opcodes";
import { MockFileHandler } from "./mockfilehandler.class";

const assemble = (cpu: Mos65xxHandler, source: string) => {
	const assembler = new Assembler(cpu, new MockFileHandler(), { segments: [{ name: "CODE", start: 0x8000, size: 0, resizable: true }] });
	return assembler.assemble(source).find((s) => s.name === "CODE")?.data ?? [];
};

describe("Mos65xxHandler", () => {
	// Merging a profile's opcode sets throws on a clash: building each handler checks its profile.
	it.each([P6502, P65C02])("should build the $cpuType from its profile", (profile) => {
		expect(new Mos65xxHandler(profile).cpuType).toBe(profile.cpuType);
	});

	it("should throw when two opcode sets give the same mnemonic and mode", () => {
		const profile = { cpuType: "test", opcodeSets: [NMOS, CMOS_ADDITIONS, { LDA: { IMMEDIATE: 0x00 } }], suffixes: {} };
		expect(() => new Mos65xxHandler(profile)).toThrow("The test's opcode sets give LDA IMMEDIATE twice.");
	});

	it.each(["STP", "WAI", "RMB0", "SMB7", "BBR0", "BBS7"])("should give %s to the 65C02 only", (mnemonic) => {
		expect(new Cpu65C02Handler().isInstruction(mnemonic)).toBe(true);
		expect(new Cpu6502Handler().isInstruction(mnemonic)).toBe(false);
	});

	it("should not add a 65C02 mode to the 6502 by building a 65C02 first", () => {
		new Cpu65C02Handler();
		expect(NMOS.LDA).not.toHaveProperty("ZEROPAGE_INDIRECT");
		expect(() => assemble(new Cpu6502Handler(), "LDA ($12)")).toThrow("Invalid addressing mode for instruction LDA");
		expect(assemble(new Cpu65C02Handler(), "LDA ($12)")).toEqual([0xb2, 0x12]);
	});
});
