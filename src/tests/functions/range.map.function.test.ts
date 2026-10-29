import { describe, expect, it } from "vitest";
import { Assembler } from "../../assembler/polyasm";
import { Cpu6502Handler } from "../../cpu/cpu6502.class";
import { MockFileHandler } from "../mockfilehandler.class";

const assemble = (source: string) => {
	const asm = new Assembler(new Cpu6502Handler(), new MockFileHandler(), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
	asm.assemble(source);
	return asm.link();
};

/** The error assembling `source` throws, at `line` and `column`. */
const errorAt = (message: string, line: number, column?: number) =>
	expect.objectContaining({ message, location: expect.objectContaining(column === undefined ? { line } : { line, column }) });

describe("Function .range()", () => {
	it("should give count numbers from start", () => {
		expect(assemble(".db ... .range(0, 4)")).toEqual([0, 1, 2, 3]);
		expect(assemble(".db ... .range(1, 3)")).toEqual([1, 2, 3]);
	});

	it("should take a step, negative too", () => {
		expect(assemble(".db ... .range(0, 4, 2)")).toEqual([0, 2, 4, 6]);
		expect(assemble(".db ... .range(5, 3, -1)")).toEqual([5, 4, 3]);
	});

	it("should give an empty array for a count of 0", () => {
		expect(assemble(".db .len(.range(3, 0))")).toEqual([0]);
	});

	it("should be what a .for loops over", () => {
		const bytes = assemble(`
			.for x of .range(0, 3, 16)
				.db x
			.end
		`);
		expect(bytes).toEqual([0, 16, 32]);
	});

	it("should reject a count that isn't a whole number, 0 or more", () => {
		expect(() => assemble(".db ... .range(0, -1)")).toThrow(errorAt(".RANGE() count: -1 isn't a whole number (0 or more).", 1, 10));
		expect(() => assemble(".db ... .range(0, 3 / 2)")).toThrow(".RANGE() count: 1.5 isn't a whole number (0 or more).");
		expect(() => assemble('.db ... .range(0, "A")')).toThrow(".RANGE() count: A isn't a whole number (0 or more).");
	});

	it("should reject a start or a step that isn't a whole number, and a step of 0", () => {
		expect(() => assemble(".db ... .range(1 / 2, 2)")).toThrow(".RANGE() start: 0.5 isn't a whole number.");
		expect(() => assemble(".db ... .range(0, 2, 1 / 2)")).toThrow(".RANGE() step: 0.5 isn't a whole number other than 0.");
		expect(() => assemble(".db ... .range(0, 2, 0)")).toThrow(".RANGE() step: 0 isn't a whole number other than 0.");
	});
});

describe("Function .map()", () => {
	it("should call a user function on each element", () => {
		const bytes = assemble(`
			.fn row(c) = c * 16
			.db ... .map(.range(0, 16), row)
		`);
		expect(bytes).toEqual([0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0]);
	});

	it("should call a block function", () => {
		const bytes = assemble(`
			.function clamp(x) {
				.if x > 2
					.return 2
				.end
				.return x
			}
			.db ... .map([1, 2, 3, 4], clamp)
		`);
		expect(bytes).toEqual([1, 2, 2, 2]);
	});

	it("should call a system function, its dot written, not called", () => {
		const bytes = assemble(`
			addrs = [$1234, $5678]
			.db ... .map(addrs, .lobyte)
			.db ... .map(addrs, .HiByte)
		`);
		expect(bytes).toEqual([0x34, 0x78, 0x12, 0x56]);
	});

	it("should spread without a space, ....map", () => {
		expect(assemble(".db ....map([$102, $304], .lobyte)")).toEqual([2, 4]);
	});

	it("should give an array, mapped again", () => {
		expect(assemble(".db ... .map(.map([1, 22], .str), .len)")).toEqual([1, 2]);
	});

	it("should take a label defined after it, the array's length known in pass 1", () => {
		const bytes = assemble(`
			.db ... .map([data, data + 1], .lobyte)
			data: nop
		`);
		expect(bytes).toEqual([0x02, 0x03, 0xea]);
	});

	it("should take the function from a macro parameter, user or system", () => {
		const bytes = assemble(`
			.macro table list, fn
				.db ... .map(list, fn)
			.end
			.fn double(x) = x * 2
			table [1, 2], double
			table [$1234], .hibyte
		`);
		expect(bytes).toEqual([2, 4, 0x12]);
	});

	it("should map a macro's rest parameter", () => {
		const bytes = assemble(`
			.macro low ...values
				.db ... .map(values, .lobyte)
			.end
			low $102, $304
		`);
		expect(bytes).toEqual([2, 4]);
	});

	it("should reject a function not defined before it, even for an empty array", () => {
		expect(() => assemble(".db ... .map([1], nope)")).toThrow(errorAt("Unknown function 'nope'.", 1, 19));
		expect(() => assemble(".db .len(.map([], nope))")).toThrow("Unknown function 'nope'.");
		expect(() => assemble(".db ... .map([1], later)\n.fn later(x) = x")).toThrow("Unknown function 'later'.");
		expect(() => assemble(".db ... .map([1], .nope)")).toThrow("Unknown function 'NOPE'.");
	});

	it("should reject a symbol that isn't a function", () => {
		expect(() => assemble("v = 1\n.db ... .map([1], v)")).toThrow(errorAt("'v' isn't a function.", 2, 19));
	});

	it("should reject a function that doesn't take one argument", () => {
		expect(() => assemble(".fn f(a, b) = a\n.db .len(.map([], f))")).toThrow(".MAP() calls its function with one argument, each element: 'f' takes 2.");
		expect(() => assemble(".db ... .map([1], .Pad)")).toThrow(".MAP() calls its function with one argument, each element: '.Pad' takes 2 to 3.");
		expect(() => assemble(".db ... .map([1], .push)")).toThrow(".MAP() calls its function with one argument, each element: '.push' takes 2 or more.");
	});

	it("should reject a function's value instead of its name, and a value that isn't an array", () => {
		const notAFunction = "Second argument to .MAP() must be a function, by its name: .map(list, f) or .map(list, .lobyte).";
		expect(() => assemble(".db ... .map([1], 3)")).toThrow(notAFunction);
		expect(() => assemble(".db ... .map([1], .lobyte(2))")).toThrow(notAFunction);
		expect(() => assemble(".fn f(x) = x\n.db ... .map([1], (f))")).toThrow("'f' is a function: call it, f(…).");
		expect(() => assemble(".db ... .map(1, .lobyte)")).toThrow("First argument to .MAP() must be an array.");
	});
});
