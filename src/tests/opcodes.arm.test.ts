import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { CpuArmRiscHandler } from "../cpu/cpuarm.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("ARM Opcodes", () => {
	const assemble = (source: string) => {
		const assembler = new Assembler(new CpuArmRiscHandler(), new MockFileHandler(), {
			segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		});
		assembler.assemble(source);
		return assembler.link();
	};

	// Every instruction is 4 bytes: an operand using a symbol defined later can't change the size.
	it.each([
		["MOV R1, #value\nvalue = 5", [0x05, 0x10, 0xa0, 0xe3]],
		["B later\nMOV R1, #1\nlater: MOV R2, #2", [0x00, 0x00, 0x00, 0xea, 0x01, 0x10, 0xa0, 0xe3, 0x02, 0x20, 0xa0, 0xe3]],
	])("should assemble an operand defined later: %j", (source, bytes) => {
		expect(assemble(source)).toEqual(bytes);
	});

	it("should assemble the same operands defined before", () => {
		expect(assemble("MOV R1, #5")).toEqual([0x05, 0x10, 0xa0, 0xe3]);
		expect(assemble("here: B here")).toEqual([0xfe, 0xff, 0xff, 0xea]);
	});

	it("should store instructions in the same byte order as data", () => {
		// mov r1, #5 is the word $E3A01005: little-endian, like .dl
		expect(assemble("MOV R1, #5\n.DL $E3A01005")).toEqual([0x05, 0x10, 0xa0, 0xe3, 0x05, 0x10, 0xa0, 0xe3]);
	});
});
