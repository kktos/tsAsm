import { describe, expect, it } from "vitest";
import { readConf } from "../cli/conf";
import { MockFileHandler } from "./mockfilehandler.class";

function readConfFrom(yaml: string) {
	const fileHandler = new MockFileHandler();
	fileHandler.readSourceFile = () => yaml;
	return readConf(fileHandler, "project.yaml");
}

const confWithCpu = (cpu: string) => `
input:
  cpu: ${cpu}
  source: main.asm
  segments:
    - { name: CODE, start: 0x1000, size: 0x100 }
`;

describe("CLI conf", () => {
	it("accepts a numeric cpu name", () => {
		const { conf, errors } = readConfFrom(confWithCpu("6502"));
		expect(errors).toBeUndefined();
		expect(conf.input.cpu).toBe("6502");
	});

	it("accepts a cpu name in any case", () => {
		const { errors } = readConfFrom(confWithCpu("65c02"));
		expect(errors).toBeUndefined();
	});

	it("reports an unknown cpu", () => {
		const { errors } = readConfFrom(confWithCpu("Z80"));
		expect(errors).toEqual([{ path: "input.cpu", message: expect.stringContaining("Invalid cpu") }]);
	});

	it("reports a cpu of the wrong type instead of crashing", () => {
		const { errors } = readConfFrom(confWithCpu("true"));
		expect(errors).toEqual([{ path: "input.cpu", message: "Expected string, got boolean" }]);
	});
});
