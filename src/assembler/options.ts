/** The `.option` names, with their default. `AssemblerOptions.options` (a project file's `input.options`) changes the defaults. */
export const DEFAULT_OPTIONS = {
	/** Starts a local label: `:loop`. */
	"local.prefix": ":",
	/** Alone, defines an anonymous label (`:`); followed by signs, refers to one (`:-`, `:++`, `:+3`). */
	"anon.marker": ":",
	/** How the listing writes the mnemonics, registers and symbols: `upper` (LDA), `lower` (lda) or `source`, as written. */
	"listing.case": "upper",
	/** How the listing writes data and loops of data: `expand`, every byte, or `fold`, the first row only. */
	"listing.data": "expand",
	/** The first value of a `.repeat` iterator: 0 or 1. */
	"repeat.start": 1,
	/** The first value of a `.for` index: 0 or 1. */
	"for.start": 0,
	/** How deep a user function can call itself, directly or through another: 0 to 256, 0 for not at all. */
	"function.recursion": 64,
};

export type OptionName = keyof typeof DEFAULT_OPTIONS;

/** Each option's short name, for the command line: `-O ld=fold`, `--ld fold`. Declared, not computed, so adding an option never changes what one means. */
export const OPTION_SHORT_NAMES: Record<OptionName, string> = {
	"local.prefix": "lp",
	"anon.marker": "am",
	"listing.case": "lc",
	"listing.data": "ld",
	"repeat.start": "rs",
	"for.start": "fs",
	"function.recursion": "fr",
};
export type OptionValue = string | number;
export type Options = Partial<Record<OptionName, OptionValue>>;

/**
 * The options local to a file: each file starts with the values the assembler was given, and a macro body runs with
 * the values where the macro is defined. The others are global: they carry into the files a source includes, and an
 * included file's stay after it.
 */
export const LOCAL_OPTIONS = ["repeat.start", "for.start"] as const satisfies OptionName[];
export type LocalOptions = Record<(typeof LOCAL_OPTIONS)[number], OptionValue>;

/** The chars a local label prefix or an anonymous label marker can be. */
const LABEL_CHARS = [":", "@", "!", "?", "_", "~"];
export const LABEL_CHARS_TEXT = LABEL_CHARS.map((ch) => `'${ch}'`).join(", ");

export function isLabelChar(value: unknown): value is string {
	return typeof value === "string" && LABEL_CHARS.includes(value);
}

/** The values of `listing.case`. */
const LISTING_CASES = ["upper", "lower", "source"] as const;
export type ListingCase = (typeof LISTING_CASES)[number];
export const LISTING_CASES_TEXT = LISTING_CASES.map((value) => `'${value}'`).join(", ");

export function isListingCase(value: unknown): value is ListingCase {
	return typeof value === "string" && (LISTING_CASES as readonly string[]).includes(value);
}

/** The values of `listing.data`. */
const LISTING_DATA = ["expand", "fold"] as const;
export type ListingData = (typeof LISTING_DATA)[number];
export const LISTING_DATA_TEXT = LISTING_DATA.map((value) => `'${value}'`).join(", ");

export function isListingData(value: unknown): value is ListingData {
	return typeof value === "string" && (LISTING_DATA as readonly string[]).includes(value);
}

/** The values of `repeat.start` and `for.start`. */
const LOOP_STARTS = [0, 1];
export const LOOP_STARTS_TEXT = LOOP_STARTS.join(", ");

export function isLoopStart(value: unknown): value is number {
	return typeof value === "number" && LOOP_STARTS.includes(value);
}

/** The values of `function.recursion`: a whole number in this range. */
const MAX_FUNCTION_RECURSION = 256;
export const FUNCTION_RECURSION_TEXT = `0 to ${MAX_FUNCTION_RECURSION}`;

export function isFunctionRecursion(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_FUNCTION_RECURSION;
}

/** What each option's value can be, the values the help lists, and what the error message says it must be (`one of <text>` unless given). */
const OPTION_VALUES: Record<OptionName, { isValid: (value: unknown) => boolean; text: string; expected?: string }> = {
	"local.prefix": { isValid: isLabelChar, text: LABEL_CHARS_TEXT },
	"anon.marker": { isValid: isLabelChar, text: LABEL_CHARS_TEXT },
	"listing.case": { isValid: isListingCase, text: LISTING_CASES_TEXT },
	"listing.data": { isValid: isListingData, text: LISTING_DATA_TEXT },
	"repeat.start": { isValid: isLoopStart, text: LOOP_STARTS_TEXT },
	"for.start": { isValid: isLoopStart, text: LOOP_STARTS_TEXT },
	"function.recursion": { isValid: isFunctionRecursion, text: FUNCTION_RECURSION_TEXT, expected: `a whole number from ${FUNCTION_RECURSION_TEXT}` },
};

export function isOptionName(name: string): name is OptionName {
	return Object.hasOwn(DEFAULT_OPTIONS, name);
}

/** The option named `name`, by its full or its short name, or undefined. */
export function findOptionName(name: string): OptionName | undefined {
	if (isOptionName(name)) return name;
	return (Object.keys(OPTION_SHORT_NAMES) as OptionName[]).find((optionName) => OPTION_SHORT_NAMES[optionName] === name);
}

/** The values the option `name` can take, as the error messages list them. */
export function optionValuesText(name: OptionName): string {
	return OPTION_VALUES[name].text;
}

/** Why `value` can't be the value of the option `name`, or undefined when it can. */
export function optionValueError(name: OptionName, value: unknown): string | undefined {
	const { isValid, text, expected = `one of ${text}` } = OPTION_VALUES[name];
	if (isValid(value)) return undefined;
	return `'${name}' must be ${expected}.`;
}

/** The options given to the assembler, with the defaults for the others. An unknown option or a wrong value throws. */
export function withDefaultOptions(options: Record<string, unknown> = {}): Record<OptionName, OptionValue> {
	for (const [name, value] of Object.entries(options)) {
		if (!isOptionName(name)) throw new Error(`Unknown option '${name}'.`);
		const error = optionValueError(name, value);
		if (error) throw new Error(error);
	}
	return { ...DEFAULT_OPTIONS, ...(options as Options) };
}
