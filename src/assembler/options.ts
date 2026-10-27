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
};

export type OptionName = keyof typeof DEFAULT_OPTIONS;
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

/** What each option's value can be, and the values the error message lists. */
const OPTION_VALUES: Record<OptionName, { isValid: (value: unknown) => boolean; text: string }> = {
	"local.prefix": { isValid: isLabelChar, text: LABEL_CHARS_TEXT },
	"anon.marker": { isValid: isLabelChar, text: LABEL_CHARS_TEXT },
	"listing.case": { isValid: isListingCase, text: LISTING_CASES_TEXT },
	"listing.data": { isValid: isListingData, text: LISTING_DATA_TEXT },
	"repeat.start": { isValid: isLoopStart, text: LOOP_STARTS_TEXT },
	"for.start": { isValid: isLoopStart, text: LOOP_STARTS_TEXT },
};

export function isOptionName(name: string): name is OptionName {
	return Object.hasOwn(DEFAULT_OPTIONS, name);
}

/** Why `value` can't be the value of the option `name`, or undefined when it can. */
export function optionValueError(name: OptionName, value: unknown): string | undefined {
	const { isValid, text } = OPTION_VALUES[name];
	if (isValid(value)) return undefined;
	return `'${name}' must be one of ${text}.`;
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
