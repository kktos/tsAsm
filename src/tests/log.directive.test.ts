import { describe, expect, it, vi } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
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
};

function makeAssembler() {
	const sink = new MemorySink();
	const logger = new Logger({ sink, enabled: true });
	const asm = new Assembler(fakeCPU, new MockFileHandler(), {
		logger,
		log: { pass1Enabled: true, pass2Enabled: true },
	});
	return { asm, sink };
}

describe("Logging directives", () => {
	describe(".LOG directive", () => {
		it("logs a single numeric expression", () => {
			const { asm, sink } = makeAssembler();
			const src = ".LOG 1+2";
			asm.assemble(src);

			const found = sink.logs.find((l) => l === "3");
			expect(found).toBeDefined();
		});

		it("logs a expression with function calls", () => {
			const { asm, sink } = makeAssembler();
			const src = `.LOG "var=" + .hex(12,4)`;
			asm.assemble(src);

			// expect(logger.lines).toBe("");

			const found = sink.logs.find((l) => l === "var=$000C");
			expect(found).toBeDefined();
		});

		it("logs multiple comma-separated expressions", () => {
			const { asm, sink } = makeAssembler();
			const src = '.LOG 10, "HELLO", [1,2]';
			asm.assemble(src);

			const found = sink.logs.find((l) => l === "10	HELLO	[1, 2]");
			expect(found).toBeDefined();
		});
	});

	describe(".ERR directive", () => {
		it("log a simple error", () => {
			const { asm } = makeAssembler();
			const src = `.ERR "Boom Bada Boom"`;
			expect(() => asm.assemble(src)).toThrow(/Boom Bada Boom/);
		});
	});

	describe(".WARN directive", () => {
		it("log a simple warning", () => {
			const { asm, sink } = makeAssembler();
			const src = `.WARN "Boom Bada Boom"`;
			asm.assemble(src);

			// expect(sink.warnings).toBe("");

			// located like an error: the statement, then its source line
			const found = sink.warnings.find((l) => l.startsWith("1:1: warning: Boom Bada Boom\n"));
			expect(found).toBeDefined();
		});

		it("warns once, with symbols defined later", () => {
			const { asm, sink } = makeAssembler();
			asm.assemble('.WARNING "size", size\nsize = 5');

			expect(sink.warnings).toEqual([expect.stringMatching(/^1:1: warning: size\t5\n/)]);
		});
	});

	it("logs an object without writing to the console", () => {
		const sink = new MemorySink();
		const logger = new Logger({ sink, enabled: true });
		const rawDataProcessors = { default: "JSON", map: new Map([["JSON", (block: string) => JSON.parse(block)]]) };
		const asm = new Assembler(fakeCPU, new MockFileHandler(), {
			logger,
			rawDataProcessors,
			log: { pass1Enabled: false, pass2Enabled: true },
		});
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

		asm.assemble('.DEFINE obj\n{"a": 1}\n.END\n.LOG obj');
		// read the calls before mockRestore(), which clears them
		const consoleCalls = consoleLog.mock.calls.length;
		consoleLog.mockRestore();

		expect(consoleCalls).toBe(0);
		expect(sink.logs).toContain('{"a":1}');
	});
});
