/** The `.option` names, with their default. `AssemblerOptions.options` (a project file's `input.options`) changes the defaults. */
export const DEFAULT_OPTIONS = {
	/** Starts a local label: `:loop`. */
	"local.prefix": ":",
	/** Alone, defines an anonymous label (`:`); followed by signs, refers to one (`:-`, `:++`, `:+3`). */
	"anon.marker": ":",
	/** How the listing writes the mnemonics: `upper` (LDA), `lower` (lda) or `source`, as written. */
	"listing.case": "upper",
};

export type OptionName = keyof typeof DEFAULT_OPTIONS;
export type Options = Partial<Record<OptionName, string>>;

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

/** What each option's value can be, and the values the error message lists. */
const OPTION_VALUES: Record<OptionName, { isValid: (value: unknown) => boolean; text: string }> = {
	"local.prefix": { isValid: isLabelChar, text: LABEL_CHARS_TEXT },
	"anon.marker": { isValid: isLabelChar, text: LABEL_CHARS_TEXT },
	"listing.case": { isValid: isListingCase, text: LISTING_CASES_TEXT },
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
export function withDefaultOptions(options: Record<string, unknown> = {}): Record<OptionName, string> {
	for (const [name, value] of Object.entries(options)) {
		if (!isOptionName(name)) throw new Error(`Unknown option '${name}'.`);
		const error = optionValueError(name, value);
		if (error) throw new Error(error);
	}
	return { ...DEFAULT_OPTIONS, ...(options as Options) };
}
