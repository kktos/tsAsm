/** The `.option` names, with their default. `AssemblerOptions.options` (a project file's `input.options`) changes the defaults. */
export const DEFAULT_OPTIONS = {
	/** Starts a local label: `:loop`. */
	"local.prefix": ":",
	/** Alone, defines an anonymous label (`:`); followed by signs, refers to one (`:-`, `:++`, `:+3`). */
	"anon.marker": ":",
};

export type OptionName = keyof typeof DEFAULT_OPTIONS;
export type Options = Partial<Record<OptionName, string>>;

/** The chars a local label prefix or an anonymous label marker can be. */
const LABEL_CHARS = [":", "@", "!", "?", "_", "~"];
export const LABEL_CHARS_TEXT = LABEL_CHARS.map((ch) => `'${ch}'`).join(", ");

export function isLabelChar(value: unknown): value is string {
	return typeof value === "string" && LABEL_CHARS.includes(value);
}

export function isOptionName(name: string): name is OptionName {
	return Object.hasOwn(DEFAULT_OPTIONS, name);
}

/** Why `value` can't be the value of the option `name`, or undefined when it can. */
export function optionValueError(name: OptionName, value: unknown): string | undefined {
	if (isLabelChar(value)) return undefined;
	return `'${name}' must be one of ${LABEL_CHARS_TEXT}.`;
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
