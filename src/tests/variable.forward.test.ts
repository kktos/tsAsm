import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
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
	endianness: "little" as const,
};

const assemble = (source: string) => {
	const assembler = new Assembler(fakeCPU, new MockFileHandler(), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
	assembler.assemble(source);
	return Array.from(assembler.link());
};

const ambiguous = (name: string) => `Variable '${name}' is used before it's assigned, and it's assigned more than once: its value here is ambiguous.`;

describe("A variable used before it's assigned", () => {
	it("is an error when it's assigned more than once", () => {
		const source = `
			.db v
			v = 1
			v = 2
		`;
		expect(() => assemble(source)).toThrow(expect.objectContaining({ message: ambiguous("V"), location: expect.objectContaining({ line: 2, column: 8 }) }));
	});

	it("is an error when a loop assigns it", () => {
		const source = `
			.db v
			v = 0
			.repeat 3 {
				v = v + 1
			}
		`;
		expect(() => assemble(source)).toThrow(ambiguous("V"));
	});

	it("is an error when the loop body uses it before assigning it", () => {
		const source = `
			.repeat 2 {
				.db t
				t = 1
			}
		`;
		expect(() => assemble(source)).toThrow(ambiguous("T"));
	});

	it("is an error with .let", () => {
		const source = `
			.db v
			.let v = 1
			.let v = 2
		`;
		expect(() => assemble(source)).toThrow(ambiguous("V"));
	});

	it("is an error in a function's argument", () => {
		const source = `
			.db .len(v)
			v = "a"
			v = "bc"
		`;
		expect(() => assemble(source)).toThrow(ambiguous("V"));
	});

	it("is an error in a macro body", () => {
		const source = `
			.macro m
				.db w
				w = 1
				w = 2
			.end
			m
		`;
		expect(() => assemble(source)).toThrow(ambiguous("W"));
	});

	it("takes its value when it's assigned once", () => {
		const source = `
			.db v
			v = 1
		`;
		expect(assemble(source)).toEqual([1]);
	});

	it("isn't seen by .def, so a guarded use is fine", () => {
		const source = `
			.if .def(v)
				.db v
			.end
			v = 1
			v = 2
			.db v
		`;
		expect(assemble(source)).toEqual([2]);
	});
});

describe("A variable used after it's assigned", () => {
	it("has the value it has at that point", () => {
		const source = `
			v = 1
			.db v
			v = 2
			.db v
		`;
		expect(assemble(source)).toEqual([1, 2]);
	});

	it("follows a loop's assignments", () => {
		const source = `
			s = 0
			.repeat 3 as i {
				s = s + i
				.db s
			}
		`;
		expect(assemble(source)).toEqual([1, 3, 6]);
	});
});

describe("A constant used before it's defined", () => {
	it("takes its value", () => {
		const source = `
			.db k
			k .equ 3
		`;
		expect(assemble(source)).toEqual([3]);
	});
});
