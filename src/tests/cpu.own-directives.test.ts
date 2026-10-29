import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { CPUHandler } from "../cpu/cpuhandler.interface";
import type { DirectiveContext, IDirective } from "../directives/directive.interface";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import { MockFileHandler } from "./mockfilehandler.class";

const directive = (run: (context: DirectiveContext) => void): IDirective => ({
	isBlockDirective: false,
	isRawDirective: false,
	handlePassOne: (_directive: ScalarToken, context: DirectiveContext) => run(context),
	handlePassTwo: (_directive: ScalarToken, context: DirectiveContext) => run(context),
});

/** A CPU keeping state, as the 65816 keeps M / X: `.wide` sets it, `.emitwide` writes it. */
class WideCpu extends Cpu65C02Handler {
	public override cpuType: string;
	public wide = false;
	public directives: Record<string, IDirective> = {
		WIDE: directive(() => {
			this.wide = true;
		}),
		EMITWIDE: directive((context) => context.emitbytes([this.wide ? 1 : 0])),
	};

	constructor(name = "WIDE") {
		super();
		this.cpuType = name;
	}

	resetState() {
		this.wide = false;
	}
}

describe("A CPU's own directives", () => {
	const createAssembler = (cpus: CPUHandler[]) =>
		new Assembler(cpus, new MockFileHandler(), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
	const assemble = (cpus: CPUHandler[], source: string) => {
		const assembler = createAssembler(cpus);
		assembler.assemble(source);
		return assembler.link();
	};

	it("should run while its CPU is the current one", () => {
		const source = `
			.emitwide
			.wide
			.emitwide
		`;
		expect(assemble([new WideCpu()], source)).toEqual([0, 1]);
	});

	it("should be an error while another CPU is the current one", () => {
		const source = `
			.wide
		`;
		expect(() => assemble([new Cpu6502Handler(), new WideCpu()], source)).toThrow("'.wide' is a WIDE directive: the current CPU is 6502.");
	});

	it("should run after a .cpu switching to its CPU", () => {
		const source = `
			.cpu WIDE
			.wide
			.emitwide
		`;
		expect(assemble([new Cpu6502Handler(), new WideCpu()], source)).toEqual([1]);
	});

	it("should be known in a branch not taken, whatever the current CPU", () => {
		const source = `
			.if 0
			.wide
			.end
			nop
		`;
		expect(assemble([new Cpu6502Handler(), new WideCpu()], source)).toEqual([0xea]);
	});

	it("should not be known when its CPU isn't given to the assembler", () => {
		const source = `
			.wide
		`;
		expect(() => assemble([new Cpu6502Handler()], source)).toThrow("Syntax error - Unexpected directive 'WIDE'");
	});

	it("should run the current CPU's when two CPUs have one with the same name", () => {
		const first = new WideCpu("FIRST");
		const second = new WideCpu("SECOND");
		const source = `
			.wide
			.cpu SECOND
			.emitwide
			.cpu FIRST
			.emitwide
		`;
		expect(assemble([first, second], source)).toEqual([0, 1]);
	});

	it("should name every CPU having it in the error", () => {
		const source = `
			.wide
		`;
		expect(() => assemble([new Cpu6502Handler(), new WideCpu("FIRST"), new WideCpu("SECOND")], source)).toThrow(
			"'.wide' is a FIRST / SECOND directive: the current CPU is 6502.",
		);
	});

	it("should not take the name of a general directive", () => {
		const cpu = new WideCpu();
		cpu.directives.ORG = directive(() => {});
		expect(() => createAssembler([cpu])).toThrow("The WIDE directive '.ORG' has the name of a general directive.");
	});
});

describe("A CPU's state", () => {
	const createAssembler = (cpus: CPUHandler[]) =>
		new Assembler(cpus, new MockFileHandler(), { segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }] });
	const assemble = (assembler: Assembler, source: string) => {
		assembler.assemble(source);
		return assembler.link();
	};

	it("should start each pass as after reset", () => {
		// Kept from pass 1, the state would be wide at the start of pass 2.
		const source = `
			.emitwide
			.wide
		`;
		expect(assemble(createAssembler([new WideCpu()]), source)).toEqual([0]);
	});

	it("should start each assemble() as after reset", () => {
		const assembler = createAssembler([new WideCpu()]);
		assemble(assembler, ".wide");
		expect(assemble(assembler, ".emitwide")).toEqual([0]);
	});

	it("should be reset when its CPU isn't the one the source starts with", () => {
		const source = `
			.cpu WIDE
			.emitwide
			.wide
		`;
		expect(assemble(createAssembler([new Cpu6502Handler(), new WideCpu()]), source)).toEqual([0]);
	});

	it("should be kept across .cpu switches", () => {
		const source = `
			.wide
			.cpu 6502
			nop
			.cpu WIDE
			.emitwide
		`;
		expect(assemble(createAssembler([new WideCpu(), new Cpu6502Handler()]), source)).toEqual([0xea, 1]);
	});
});
