import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPTIONS, OPTION_SHORT_NAMES, type OptionName } from "../assembler/options";
import { parseCliArgs } from "../cli/args";

class ExitError extends Error {}

let errors: string[];

beforeEach(() => {
	errors = [];
	vi.spyOn(process, "exit").mockImplementation(() => {
		throw new ExitError();
	});
	vi.spyOn(console, "error").mockImplementation((message: string) => errors.push(message));
});

afterEach(() => {
	vi.restoreAllMocks();
});

const parse = (...argv: string[]) => parseCliArgs(argv, "tsasm");

// The errors parseCliArgs prints before it exits, without their colour
function parseErrors(...argv: string[]): string[] {
	errors = [];
	expect(() => parse(...argv)).toThrow(ExitError);
	return errors.map(stripVTControlCharacters);
}

describe("CLI args: .option values", () => {
	it("has no option by default", () => {
		expect(parse("proj.yaml").options).toEqual({});
	});

	it("takes -O <name>=<value>", () => {
		expect(parse("proj.yaml", "-O", "listing.data=fold").options).toEqual({ "listing.data": "fold" });
	});

	it("takes --<name> <value> and --<name>=<value>", () => {
		expect(parse("--listing.data", "fold", "proj.yaml").options).toEqual({ "listing.data": "fold" });
		expect(parse("proj.yaml", "--listing.case=lower").options).toEqual({ "listing.case": "lower" });
	});

	it("takes the short names wherever a full name works", () => {
		expect(parse("proj.yaml", "-O", "ld=fold", "--lc", "source", "--lp=@").options).toEqual({
			"listing.data": "fold",
			"listing.case": "source",
			"local.prefix": "@",
		});
	});

	it("reads repeat.start and for.start as numbers", () => {
		expect(parse("proj.yaml", "-O", "rs=0", "--for.start", "1").options).toEqual({ "repeat.start": 0, "for.start": 1 });
	});

	it("keeps the project name and the other flags", () => {
		const args = parse("-O", "ld=fold", "proj.yaml", "--link", "false");
		expect(args.projectName).toBe("proj.yaml");
		expect(args.link).toBe(false);
	});

	it("lists the known options for an unknown one", () => {
		expect(parseErrors("proj.yaml", "-O", "listing.fold=1")).toEqual([
			"ERROR: Unknown option 'listing.fold': the options are local.prefix (lp), anon.marker (am), listing.case (lc), listing.data (ld), repeat.start (rs), for.start (fs).",
		]);
		expect(parseErrors("proj.yaml", "--fold")).toEqual([
			"ERROR: Unknown option: --fold. The .option names are local.prefix (lp), anon.marker (am), listing.case (lc), listing.data (ld), repeat.start (rs), for.start (fs); see --help for the others.",
		]);
	});

	it("says what the value must be, as for the project file and .option", () => {
		expect(parseErrors("proj.yaml", "--ld", "compact")).toEqual(["ERROR: 'listing.data' must be one of 'expand', 'fold'."]);
		expect(parseErrors("proj.yaml", "-O", "rs=2")).toEqual(["ERROR: 'repeat.start' must be one of 0, 1."]);
		expect(parseErrors("proj.yaml", "-O", "fs=one")).toEqual(["ERROR: 'for.start' must be one of 0, 1."]);
	});

	it("rejects an option given twice, by any of its names", () => {
		expect(parseErrors("proj.yaml", "-O", "ld=fold", "--listing.data", "expand")).toEqual(["ERROR: The option 'listing.data' is given twice."]);
	});

	it("rejects -O without <name>=<value> and --<name> without a value", () => {
		expect(parseErrors("proj.yaml", "-O", "ld")).toEqual(["ERROR: Invalid value for -O: 'ld'. Expected <option>=<value>, e.g. -O listing.data=fold."]);
		expect(parseErrors("proj.yaml", "--ld")).toEqual(["ERROR: Missing value for --ld."]);
	});
});

describe("Option short names", () => {
	const names = Object.keys(DEFAULT_OPTIONS) as OptionName[];

	it("every option has one", () => {
		expect(Object.keys(OPTION_SHORT_NAMES).sort()).toEqual([...names].sort());
	});

	it("are unique, and none is a full name or another flag", () => {
		const shortNames = Object.values(OPTION_SHORT_NAMES);
		expect(new Set(shortNames).size).toBe(shortNames.length);
		for (const shortName of shortNames) expect([...names, "link", "help"]).not.toContain(shortName);
	});
});
