import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

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

	describe("Metadata", () => {
		it("should parse and store metadata", () => {
			const { assembler } = createAssembler();
			const source = `.NAMESPACE myns id=1, name="test"`;
			assembler.assemble(source);

			const meta = assembler.symbolTable.getNamespaceMetadata("MYNS");
			expect(meta).toEqual({ ID: 1, NAME: "test" });
		});

		it("should evaluate expressions in metadata", () => {
			const { assembler } = createAssembler();
			const source = `
				val = 10
				.NAMESPACE myns calc=val*2
			`;
			assembler.assemble(source);

			const meta = assembler.symbolTable.getNamespaceMetadata("MYNS");
			expect(meta).toEqual({ CALC: 20 });
		});

		it("should merge metadata", () => {
			const { assembler } = createAssembler();
			const source = `
				.NAMESPACE myns a=1
				.NAMESPACE myns b=2
			`;
			assembler.assemble(source);

			const meta = assembler.symbolTable.getNamespaceMetadata("MYNS");
			expect(meta).toEqual({ A: 1, B: 2 });
		});

		it("should raises a syntax error", () => {
			const { assembler } = createAssembler();
			const source = `
				.NAMESPACE myns calc=2 test=2
			`;
			expect(() => assembler.assemble(source)).toThrowError();
		});
	});
});
