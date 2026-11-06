import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

/** The lines `onStatement` tells assembling `source`, in order, each time. */
function statements(source: string): (string | number | undefined)[] {
	const lines: (string | number | undefined)[] = [];
	const logger = new Logger({ sink: new MemorySink(), enabled: false });
	new Assembler(new Cpu6502Handler(), new MockFileHandler(), { logger, onStatement: ({ location }) => lines.push(location.line) }).assemble(source);
	return lines;
}

describe("onStatement", () => {
	it("tells the statements pass 2 reads, not an .if branch not taken", () => {
		expect(
			statements(`
	.org $1000
.if 1
	lda #1
.else
	lda #2
.end
.repeat 0
	nop
.end
`),
		).toEqual([2, 3, 4, 8]);
	});

	it("tells a macro's body at each call, a function's when it runs, nothing of those never called", () => {
		expect(
			statements(`
.macro used
	nop
.end
.macro unused
	inx
.end
.function twice(x) {
	.return x * 2
}
.function never(x) {
	.return x
}
	used
	used
	lda #twice(1)
`),
		).toEqual([2, 5, 8, 11, 14, 3, 15, 3, 16, 9]);
	});
});
