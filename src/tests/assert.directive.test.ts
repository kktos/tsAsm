import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

describe("Directive: .assert", () => {
	const assemble = (source: string) => {
		const sink = new MemorySink();
		const asm = new Assembler(new Cpu6502Handler(), new MockFileHandler(), { logger: new Logger({ sink, enabled: true }) });
		asm.assemble(source);
		return { warnings: sink.warnings.map((w) => w.split("\n")[0]), bytes: asm.link() };
	};

	it("should do nothing when the condition is true", () => {
		const { warnings, bytes } = assemble(`
			.org $1000
			.assert 1 + 1 == 2, "maths"
			nop
		`);
		expect(warnings).toEqual([]);
		expect(bytes).toEqual([0xea]);
	});

	it("should stop the assembly when the condition is false", () => {
		expect(() =>
			assemble(`
				.assert 1 == 2
			`),
		).toThrow("Assertion failed");
	});

	it("should stop the assembly with its message", () => {
		const source = `
			size = 300
			.assert size < 256, "table too big: ", size
		`;
		expect(() => assemble(source)).toThrow("table too big: \t300");
	});

	it("should stop the assembly with err or error", () => {
		expect(() => assemble(`.assert 0, err, "boom"`)).toThrow("boom");
		expect(() => assemble(`.assert 0, ERROR, "boom"`)).toThrow("boom");
	});

	it("should only warn with warn or warning", () => {
		const { warnings, bytes } = assemble(`
			.org $1000
			.assert 0, warn, "careful"
			.assert 0, Warning
			nop
		`);
		expect(warnings).toEqual(["3:4: warning: careful", "4:4: warning: Assertion failed"]);
		expect(bytes).toEqual([0xea]);
	});

	it("should check the condition with symbols defined later", () => {
		const source = `
			.org $1000
			.assert end - start <= 2, "code too long"
		start:
			nop
			nop
			nop
		end:
		`;
		expect(() => assemble(source)).toThrow("code too long");
	});

	it("should warn once, in pass 2", () => {
		const { warnings } = assemble(`
			.assert later == 1, warn, "later is ", later
			later = 2
		`);
		expect(warnings).toEqual(["2:4: warning: later is \t2"]);
	});

	it("should read a word other than warn or err as a message", () => {
		const source = `
			warnx = "custom"
			.assert 0, warnx
		`;
		expect(() => assemble(source)).toThrow("custom");
	});

	it("should check each expansion of a loop", () => {
		const source = `
			.for i of [1, 2, 3] {
				.assert i < 3, "i is ", i
			}
		`;
		expect(() => assemble(source)).toThrow("i is \t3");
	});

	it("should not check an assertion in a branch not taken", () => {
		const { warnings } = assemble(`
			.if 0
				.assert 0
			.end
		`);
		expect(warnings).toEqual([]);
	});

	it("should reject an undefined symbol in the condition", () => {
		expect(() => assemble(".assert nowhere == 1")).toThrow(/nowhere/i);
	});

	it.each([
		[".assert", "Missing expression."],
		[".assert 1,", "Missing expression."],
		['.assert 1, , "x"', "Missing expression."],
		[".assert 1 2", "Unexpected '2' after the expression."],
	])("should reject %s", (source, message) => {
		expect(() => assemble(source)).toThrow(message);
	});
});
