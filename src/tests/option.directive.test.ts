import { describe, expect, it, vi } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { MockFileHandler } from "./mockfilehandler.class";

// Minimal fake CPU handler
const fakeCPU = {
	cpuType: "6502" as const,
	isInstruction: () => false,
	resolveAddressingMode: () => ({
		mode: "",
		opcode: 0,
		bytes: 0,
		resolvedAddress: 0,
	}),
	encodeInstruction: () => [],
	endianness: "little" as const,
	addressBits: 16,
};

describe(".OPTION Directive", () => {
	const createAssembler = () => {
		const mockFileHandler = new MockFileHandler();
		return new Assembler(fakeCPU, mockFileHandler);
	};

	it("should set a valid option during pass one", () => {
		const assembler = createAssembler();
		// Options aren't stored: they're broadcast as "option:<name>" events.
		const values: string[] = [];
		assembler.emitter.on("option:local.prefix", (value: string) => values.push(value));
		const source = `
            .OPTION local.prefix "@"
        `;
		assembler.assemble(source);
		expect(values.at(-1)).toBe("@");
	});

	it("should not turn the option's arguments into a label", () => {
		const assembler = createAssembler();
		assembler.assemble(`
            .OPTION local.prefix "!"
        `);
		expect(assembler.symbolTable.lookupSymbol("LOCAL")).toBeUndefined();
		expect(assembler.symbolTable.lookupSymbol("PREFIX")).toBeUndefined();
	});

	it("should log a warning for an unknown option", () => {
		const assembler = createAssembler();
		const loggerSpy = vi.spyOn(assembler.logger, "warn").mockImplementation(() => {});
		const source = `
            .OPTION unknown_option 123
        `;
		assembler.assemble(source);
		expect(loggerSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Unknown option 'unknown_option'.",
				severity: "warning",
				location: expect.objectContaining({ line: 2 }),
			}),
		);
		// Not again in pass 2
		expect(loggerSpy).toHaveBeenCalledTimes(1);
		loggerSpy.mockRestore();
	});

	it("should warn about local_label_char, replaced by local.prefix and anon.marker", () => {
		const assembler = createAssembler();
		const loggerSpy = vi.spyOn(assembler.logger, "warn").mockImplementation(() => {});
		assembler.assemble(`
            .OPTION local_label_char "@"
        `);
		expect(loggerSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "Unknown option 'local_label_char'." }));
		loggerSpy.mockRestore();
	});

	it("should throw an error for invalid syntax (not enough arguments)", () => {
		const assembler = createAssembler();
		const source = `
            .OPTION local.prefix
        `;
		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: "Invalid .OPTION syntax. Expected: .OPTION <name> <value>",
				location: expect.objectContaining({ line: 2 }),
			}),
		);
	});

	it("should throw an error for an invalid value type", () => {
		const assembler = createAssembler();
		const source = `
            .OPTION local.prefix 123
        `;
		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: "'local.prefix' must be one of ':', '@', '!', '?', '_', '~'.",
				location: expect.objectContaining({ line: 2 }),
			}),
		);
	});

	it("should throw an error for an invalid value length", () => {
		const assembler = createAssembler();
		const source = `
            .OPTION anon.marker "@@"
        `;
		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: "'anon.marker' must be one of ':', '@', '!', '?', '_', '~'.",
				location: expect.objectContaining({ line: 2 }),
			}),
		);
	});

	// it("should not process the option in pass two", () => {
	// 	const assembler = createAssembler();
	// 	const setOptionSpy = vi.spyOn(assembler.directiveHandler.directiveMap.get(".OPTION") as any, "setOption");
	// 	assembler.assemble('.OPTION local_label_style "@"');
	// 	expect(setOptionSpy).toHaveBeenCalledTimes(1);
	// });
});
