import { describe, expect, it } from "vitest";
import { readConf } from "../cli/conf";
import { AsmError } from "../utils/error.utils";
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

	it("accepts output.listing.linker, a boolean", () => {
		const { conf, errors } = readConfFrom(`${confWithCpu("6502")}output:\n  listing:\n    linker: true\n`);
		expect(errors).toBeUndefined();
		expect(conf.output?.listing?.linker).toBe(true);
		expect(readConfFrom(`${confWithCpu("6502")}output:\n  listing:\n    linker: 1\n`).errors).toEqual([
			{ path: "output.listing.linker", message: "Expected boolean" },
		]);
	});

	it("reports a cpu of the wrong type instead of crashing", () => {
		const { errors } = readConfFrom(confWithCpu("true"));
		expect(errors).toEqual([{ path: "input.cpu", message: "Expected string, got boolean" }]);
	});

	describe("a project file that can't be used", () => {
		function confError(read: () => string) {
			const fileHandler = new MockFileHandler();
			fileHandler.readSourceFile = read;
			try {
				readConf(fileHandler, "project.yaml");
			} catch (e) {
				expect(e).toBeInstanceOf(AsmError);
				return (e as AsmError).format();
			}
			throw new Error("readConf didn't throw");
		}

		it("reports a missing file", () => {
			const notFound = Object.assign(new Error("ENOENT: no such file or directory, open 'project.yaml'"), { code: "ENOENT" });
			expect(
				confError(() => {
					throw notFound;
				}),
			).toBe("project.yaml: error: Project file not found.");
		});

		it("reports a YAML syntax error with its location", () => {
			expect(confError(() => "input:\n  source: main.asm\n   cpu: 6502\n")).toBe(
				["project.yaml:3:7: error: bad indentation of a mapping entry", "    3 |    cpu: 6502", "      |       ^"].join("\n"),
			);
		});

		it.each([
			["an empty file", ""],
			["a list", "- input\n"],
			["a scalar", "input\n"],
		])("reports %s", (_, yaml) => {
			expect(confError(() => yaml)).toBe("project.yaml: error: The project file must be a YAML mapping, with an `input` key.");
		});
	});
});
