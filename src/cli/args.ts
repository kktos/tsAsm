import { DEFAULT_OPTIONS, findOptionName, OPTION_SHORT_NAMES, type OptionName, type Options, optionValueError, optionValuesText } from "../assembler/options";
import colors from "./colors";

interface CliArgs {
	projectName: string | null;
	link: boolean;
	/** The `.option` values given on the command line: they override the project file's `input.options`. */
	options: Options;
}

const OPTION_NAMES = Object.keys(DEFAULT_OPTIONS) as OptionName[];
const OPTION_NAMES_TEXT = OPTION_NAMES.map((name) => `${name} (${OPTION_SHORT_NAMES[name]})`).join(", ");

export function parseCliArgs(argv: string[], name: string): CliArgs {
	const result: CliArgs = {
		projectName: null,
		link: true,
		options: {},
	};
	const errors: string[] = [];

	// `name` is a `.option` name, full or short; `value` as written, read as a number for a numeric option
	const setOption = (name: string, value: string) => {
		const optionName = findOptionName(name);
		if (!optionName) {
			errors.push(`Unknown option '${name}': the options are ${OPTION_NAMES_TEXT}.`);
			return;
		}
		if (Object.hasOwn(result.options, optionName)) {
			errors.push(`The option '${optionName}' is given twice.`);
			return;
		}
		const optionValue = typeof DEFAULT_OPTIONS[optionName] === "number" && /^\d+$/.test(value) ? Number(value) : value;
		const error = optionValueError(optionName, optionValue);
		if (error) errors.push(error);
		else result.options[optionName] = optionValue;
	};

	const args = [...argv]; // Create a mutable copy

	while (args.length > 0) {
		const arg = args.shift();
		if (!arg) break;

		switch (arg) {
			case "-h":
			case "--help":
				showHelp(name);
				break;
			case "-l":
			case "--link": {
				const linkValue = args.shift()?.toLowerCase();
				if (linkValue === "true") result.link = true;
				else if (linkValue === "false") result.link = false;
				else errors?.push(`Invalid value for ${arg}: '${linkValue}'. Expected 'true' or 'false'.`);
				break;
			}
			case "-O": {
				const assignment = args.shift() ?? "";
				const equalPos = assignment.indexOf("=");
				if (equalPos < 1) errors.push(`Invalid value for -O: '${assignment}'. Expected <option>=<value>, e.g. -O listing.data=fold.`);
				else setOption(assignment.slice(0, equalPos), assignment.slice(equalPos + 1));
				break;
			}
			default:
				if (arg.startsWith("--")) {
					// --listing.data fold, --listing.data=fold, --ld fold
					const equalPos = arg.indexOf("=");
					const optionName = equalPos < 0 ? arg.slice(2) : arg.slice(2, equalPos);
					if (!findOptionName(optionName)) {
						errors.push(`Unknown option: ${arg}. The .option names are ${OPTION_NAMES_TEXT}; see --help for the others.`);
						break;
					}
					const value = equalPos < 0 ? args.shift() : arg.slice(equalPos + 1);
					if (value === undefined) errors.push(`Missing value for ${arg}.`);
					else setOption(optionName, value);
				} else if (arg.startsWith("-")) errors?.push(`Unknown option: ${arg}`);
				else if (result.projectName) errors?.push(`Unexpected argument: ${arg}. Project name already set to '${result.projectName}'.`);
				else result.projectName = arg;
				break;
		}
	}

	if (!result.projectName && errors?.length === 0) errors.push("Missing mandatory project name argument.");

	if (errors.length) {
		for (const error of errors) console.error(colors.red(`ERROR: ${error}`));
		process.exit(-1);
	}

	return result;
}

function showHelp(name: string) {
	const optionLines = OPTION_NAMES.map((optionName) => {
		const names = `${optionName}, ${OPTION_SHORT_NAMES[optionName]}`;
		return `  ${names.padEnd(19)}${optionValuesText(optionName)} (default: ${DEFAULT_OPTIONS[optionName]})`;
	}).join("\n");

	console.log(`
Usage: ${name} <project-file> [options]

Arguments:
  <project-file>         Mandatory project configuration file (e.g., project.yaml).

Options:
  -l, --link <true|false>  Enable or disable the final linking stage (default: true).
  -O <option>=<value>      Set a .option value, over the project file's input.options. Can be repeated.
  --<option> <value>       The same, also written --<option>=<value>.
  -h, --help               Display this help message.

The .option names, with their short name, and their values:
${optionLines}
A .option in the source still applies after the value the command line gives.
`);
	process.exit(0);
}
