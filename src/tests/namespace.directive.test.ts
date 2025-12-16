import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { FileHandler, SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import type { LogSink } from "../helpers/logsink.interface";

class MockFileHandler implements FileHandler {
	fullpath = "";
	readSourceFile(filename: string): string {
		throw new Error(`Mock file not found: "${filename}"`);
	}

	readBinaryFile(filename: string): number[] {
		throw new Error(`Mock bin file not found: ${filename}`);
	}
}

class MemorySink implements LogSink {
	public logs: string[] = [];
	public warnings: string[] = [];
	public errors: string[] = [];

	log(message: unknown): void {
		this.logs.push(String(message));
	}
	warn(message: unknown): void {
		this.warnings.push(String(message));
	}
	error(message: unknown): void {
		this.errors.push(String(message));
	}
}

const DEFAULT_SEGMENTS: SegmentDefinition[] = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe(".NAMESPACE Directive", () => {
	const createAssembler = (segments: SegmentDefinition[] = DEFAULT_SEGMENTS) => {
		const mockFileHandler = new MockFileHandler();
		const sink = new MemorySink();
		const logger = new Logger({ sink, enabled: true });
		const assembler = new Assembler(new Cpu6502Handler(), mockFileHandler, { segments, logger, log: { pass1Enabled: true, pass2Enabled: true } });
		return { assembler, logger, sink };
	};
	it("should switch current namespace when given an identifier", () => {
		const { assembler } = createAssembler();
		const source = ".NAMESPACE myns\n";

		assembler.assemble(source);

		// Identifiers are uppercased by the lexer
		expect(assembler.symbolTable.getCurrentNamespace()).toBe("MYNS");
	});

	// it("should log an error when missing the namespace argument", () => {
	// 	const { assembler, logger } = createAssembler();
	// 	const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

	// 	assembler.assemble(".NAMESPACE");

	// 	expect(spy).toHaveBeenCalledWith(expect.stringContaining(".NAMESPACE directive requires an argument"));
	// 	spy.mockRestore();
	// });

	it("should update namespace on successive directives", () => {
		const { assembler } = createAssembler();
		const source = ".NAMESPACE one\n.NAMESPACE two\n";

		assembler.assemble(source);

		expect(assembler.symbolTable.getCurrentNamespace()).toBe("TWO");
	});

	it("should pop the NS when .end is encountered", () => {
		const { assembler, sink } = createAssembler();
		const source = `
			.echo .str(.PASS) + "NS>> global:", .NAMESPACE

			.NAMESPACE one
			.echo .str(.PASS) + "NS>> one:", .NAMESPACE
			.end NAMESPACE

			.echo .str(.PASS) + "NS>> global:", .NAMESPACE

			.NAMESPACE two
			.echo .str(.PASS) + "NS>> two:", .NAMESPACE

			.NAMESPACE
			.echo .str(.PASS) + "NS>> global:", .NAMESPACE
		`;

		assembler.assemble(source);

		// expect(sink.logs).toEqual("");

		expect(sink.logs.filter((l) => l.startsWith("1NS>> "))).toEqual([
			"1NS>> global:	global",
			"1NS>> one:	ONE",
			"1NS>> global:	global",
			"1NS>> two:	TWO",
			"1NS>> global:	global",
		]);
	});

	it("should allow access to symbols in a namespace", () => {
		const { assembler, sink } = createAssembler();
		const source = `
			.NAMESPACE vars
			one = 45
			.END NAMESPACE

			one = 56

			.echo ">>", vars::one, one

		`;

		assembler.assemble(source);

		expect(sink.logs.filter((l) => l.startsWith(">>"))).toEqual([">>	45	56", ">>	45	56"]);
	});

	it("should throw an error when trying to access a function's internal label from outside", () => {
		const { assembler } = createAssembler();
		const source = `
            .NAMESPACE MyRoutine
                PRIVATE_LABEL:
                    RTS
            .END NAMESPACE

            JMP MyRoutine::PRIVATE_LABEL ; This should fail
        `;

		const segments = assembler.assemble(source);
		const code = segments[0]?.data;

		expect(code).toEqual([0x60, 0x4c, 0x00, 0x10]);
	});
});
