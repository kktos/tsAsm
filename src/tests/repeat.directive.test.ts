import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { MockFileHandler } from "./mockfilehandler.class";

// Minimal fake CPU handler
const fakeCPU = {
	cpuType: "FakeCPU",
	isInstruction: () => false,
	resolveAddressingMode: () => ({
		mode: "",
		opcode: 0,
		bytes: 0,
		resolvedAddress: 0,
	}),
	encodeInstruction: () => [],
	getPCSize: () => 8,
};

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("Repeat Directives", () => {
	const createAssembler = (segments: SegmentDefinition[] = DEFAULT_SEGMENTS) => {
		const mockFileHandler = new MockFileHandler();
		return new Assembler(fakeCPU, mockFileHandler, { segments });
	};

	it("should repeat N times", () => {
		const assembler = createAssembler();
		const source = `
            .repeat 3 {
                .db 9
            }
        `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([9, 9, 9]);
	});

	it("should repeat with single line block declaration", () => {
		const assembler = createAssembler();
		const source = ".repeat 2 { .db 5 }";
		assembler.assemble(source);
		const machineCode = assembler.link();

		expect(machineCode).toEqual([5, 5]);
	});

	it("should repeat with an expression as count", () => {
		const assembler = createAssembler();
		const source = ".repeat 1+1 { .db 5 }";
		assembler.assemble(source);
		const machineCode = assembler.link();

		expect(machineCode).toEqual([5, 5]);
	});

	it("should provide a 1-based iterator when requested", () => {
		const assembler = createAssembler();
		const source = `
            .repeat 3 as idx {
                .db idx
            }
        `;
		assembler.assemble(source);
		const machineCode = assembler.link();

		expect(machineCode).toEqual([1, 2, 3]);
	});

	it("iterator should be local to the loop scope", () => {
		const assembler = createAssembler();
		const source = `
            .repeat 2 as idx {
                .db idx
            }
            test = idx
        `;

		expect(() => assembler.assemble(source)).toThrow(/Undefined symbol 'IDX'/);
	});

	it("can't repeat a negative count", () => {
		const assembler = createAssembler();
		const source = `
            .repeat -1 as idx {
                .db idx
            }
            test .equ idx
        `;

		expect(() => assembler.assemble(source)).toThrow(".REPEAT count on line 2: -1 isn't a whole number (0 or more).");
	});

	it("can't repeat a fractional count", () => {
		const assembler = createAssembler();
		expect(() => assembler.assemble(".repeat 5/2\n.db 1\n.end")).toThrow(".REPEAT count on line 1: 2.5 isn't a whole number (0 or more).");
	});

	it.each([
		[".repeat 0\n.db 1\n.end\n.db 2"],
		[".repeat 0 { .db 1 }\n.db 2"],
		[".repeat 0 AS i\n.db i\n.end\n.db 2"],
	])("should do nothing for a count of 0: %j", (source) => {
		const assembler = createAssembler();
		assembler.assemble(source);
		expect(assembler.link()).toEqual([2]);
	});
});
