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
		["MOV R1, #value\nvalue = 5", [0xe3, 0xa0, 0x10, 0x05]],
		["B later\nMOV R1, #1\nlater: MOV R2, #2", [0xea, 0x00, 0x00, 0x00, 0xe3, 0xa0, 0x10, 0x01, 0xe3, 0xa0, 0x20, 0x02]],
	])("should assemble an operand defined later: %j", (source, bytes) => {
		expect(assemble(source)).toEqual(bytes);
	});

	it("should assemble the same operands defined before", () => {
		expect(assemble("MOV R1, #5")).toEqual([0xe3, 0xa0, 0x10, 0x05]);
		expect(assemble("here: B here")).toEqual([0xea, 0xff, 0xff, 0xfe]);
	});
});
