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

	it("accepts a relocatable segment, with no start nor size", () => {
		const { conf, errors } = readConfFrom(`
input:
  source: main.asm
  segments:
    - { name: CODE, reloc: true }
    - { name: DATA, relocatable: true, size: 0x100 }
`);
		expect(errors).toBeUndefined();
		expect(conf.input.segments).toEqual([
			{ name: "CODE", reloc: true },
			{ name: "DATA", relocatable: true, size: 0x100 },
		]);
	});

	it("reports a relocatable flag that isn't a boolean", () => {
		const { errors } = readConfFrom(`
input:
  source: main.asm
  segments:
    - { name: CODE, reloc: 1 }
`);
		expect(errors).toEqual([expect.objectContaining({ path: expect.stringContaining("reloc"), message: "Expected boolean" })]);
	});

	it("accepts output.listing.linker, a boolean", () => {
		const { conf, errors } = readConfFrom(`${confWithCpu("6502")}output:\n  listing:\n    linker: true\n`);
		expect(errors).toBeUndefined();
		expect(conf.output?.listing?.linker).toBe(true);
		expect(readConfFrom(`${confWithCpu("6502")}output:\n  listing:\n    linker: 1\n`).errors).toEqual([
			{ path: "output.listing.linker", message: "Expected boolean" },
		]);
	});

	it("accepts input.options, the .option values the source starts with", () => {
		const { conf, errors } = readConfFrom(`${confWithCpu("6502")}  options:\n    local.prefix: "@"\n    anon.marker: ":"\n    listing.case: lower\n`);
		expect(errors).toBeUndefined();
		expect(conf.input.options).toEqual({ "local.prefix": "@", "anon.marker": ":", "listing.case": "lower" });
	});

	it("reports an unknown option or a char that can't be a label prefix", () => {
		const { errors } = readConfFrom(`${confWithCpu("6502")}  options:\n    local_label_char: "@"\n    anon.marker: "."\n`);
		expect(errors).toEqual([
			{ path: "input.options.local_label_char", message: "Unknown property" },
			{ path: "input.options.anon.marker", message: "Must be one of ':', '@', '!', '?', '_', '~'" },
		]);
	});

	it("reports a listing.case that isn't upper, lower or source", () => {
		const { errors } = readConfFrom(`${confWithCpu("6502")}  options:\n    listing.case: mixed\n`);
		expect(errors).toEqual([{ path: "input.options.listing.case", message: "Must be one of 'upper', 'lower', 'source'" }]);
	});

	it("accepts a listing.data of expand or fold, and reports another", () => {
		const { conf, errors } = readConfFrom(`${confWithCpu("6502")}  options:\n    listing.data: fold\n`);
		expect(errors).toBeUndefined();
		expect(conf.input.options).toEqual({ "listing.data": "fold" });

		const { errors: compactErrors } = readConfFrom(`${confWithCpu("6502")}  options:\n    listing.data: compact\n`);
		expect(compactErrors).toEqual([{ path: "input.options.listing.data", message: "Must be one of 'expand', 'fold'" }]);
	});

	it("accepts repeat.start and for.start of 0 or 1", () => {
		const { conf, errors } = readConfFrom(`${confWithCpu("6502")}  options:\n    repeat.start: 0\n    for.start: 1\n`);
		expect(errors).toBeUndefined();
		expect(conf.input.options).toEqual({ "repeat.start": 0, "for.start": 1 });
	});

	it("reports a repeat.start or a for.start that isn't 0 or 1", () => {
		const { errors } = readConfFrom(`${confWithCpu("6502")}  options:\n    repeat.start: 2\n    for.start: "0"\n`);
		expect(errors).toEqual([
			{ path: "input.options.repeat.start", message: "Must be one of 0, 1" },
			{ path: "input.options.for.start", message: "Expected number" },
		]);
	});

	it("accepts a function.recursion from 0 to 256, and reports another", () => {
		const { conf, errors } = readConfFrom(`${confWithCpu("6502")}  options:\n    function.recursion: 256\n`);
		expect(errors).toBeUndefined();
		expect(conf.input.options).toEqual({ "function.recursion": 256 });

		const { errors: tooDeep } = readConfFrom(`${confWithCpu("6502")}  options:\n    function.recursion: 257\n`);
		expect(tooDeep).toEqual([{ path: "input.options.function.recursion", message: "Must be a whole number from 0 to 256" }]);
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
			const notFound = Object.assign(new Error("ENOENT: no such file or directory, open 'project.yaml'"), {
				code: "ENOENT",
			});
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
