import { beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../../helpers/logger.class";
import { MemorySink } from "../../helpers/memorysink.class";
import { Linker } from "../linker.class";

describe("Linker Script: = - variable assignment", () => {
	let linker: Linker;
	let sink: MemorySink;
	let logger: Logger;

	beforeEach(() => {
		sink = new MemorySink();
		logger = new Logger({ sink, enabled: true });
		linker = new Linker();
	});

	it("should define a variable", () => {
		const src = `
				foo = 123
				.log "foo=",foo
			`;
		linker.link(src, "", logger);
		expect(sink.logs.filter((l) => l.match(/foo=\s*123/))).toEqual(["foo=	123"]);
	});

	it("should allow to change its value", () => {
		const src = `
				foo = 123
				foo = 456
				.log "foo=",foo
			`;
		linker.link(src, "", logger);
		expect(sink.logs.filter((l) => l.match(/foo=\s*456/))).toEqual(["foo=	456"]);
	});

	it.skip("should throw on missing symbol name before =", () => {
		const src = `
				foo = 123
				= 456
			`;
		expect(() => linker.link(src, "", logger)).toThrow(/Syntax error in line 3 : OPERATOR =/);
	});

	it.skip("should not work with label", () => {
		const src = `
				boo:
					= 456
			`;
		expect(() => linker.link(src, "", logger)).toThrow(/- Missing symbol name before =/);
	});
});
