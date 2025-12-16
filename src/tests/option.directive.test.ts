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
	getPCSize: () => 8,
};

describe(".OPTION Directive", () => {
	const createAssembler = () => {
		const mockFileHandler = new MockFileHandler();
		return new Assembler(fakeCPU, mockFileHandler);
	};

	it("should set a valid option during pass one", () => {
		const assembler = createAssembler();
		const source = `
            .OPTION local_label_char "@"
        `;
		assembler.assemble(source);
		expect(assembler.getOption("local_label_char")).toBe("@");
	});

	it("should log a warning for an unknown option", () => {
		const assembler = createAssembler();
		const loggerSpy = vi.spyOn(assembler.logger, "warn").mockImplementation(() => {});
		const source = `
            .OPTION unknown_option 123
        `;
		assembler.assemble(source);
		expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining("[OPTION] Unknown option 'unknown_option'"));
		loggerSpy.mockRestore();
	});

	it("should throw an error for invalid syntax (not enough arguments)", () => {
		const assembler = createAssembler();
		const source = `
            .OPTION local_label_char
        `;
		expect(() => assembler.assemble(source)).toThrow("Invalid .OPTION syntax on line 2. Expected: .OPTION <name> <value>");
	});

	it("should throw an error for an invalid value type", () => {
		const assembler = createAssembler();
		const source = `
            .OPTION local_label_char 123
        `;
		expect(() => assembler.assemble(source)).toThrow("Value for 'local_label_char' must be a single character string on line 2.");
	});

	it("should throw an error for an invalid value length", () => {
		const assembler = createAssembler();
		const source = `
            .OPTION local_label_char "@@"
        `;
		expect(() => assembler.assemble(source)).toThrow("Value for 'local_label_char' must be a single character string on line 2.");
	});

	// it("should not process the option in pass two", () => {
	// 	const assembler = createAssembler();
	// 	const setOptionSpy = vi.spyOn(assembler.directiveHandler.directiveMap.get(".OPTION") as any, "setOption");
	// 	assembler.assemble('.OPTION local_label_style "@"');
	// 	expect(setOptionSpy).toHaveBeenCalledTimes(1);
	// });
});
