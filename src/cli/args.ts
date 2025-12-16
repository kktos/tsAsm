import colors from "./colors";

interface CliArgs {
	projectName: string | null;
	link: boolean;
}

export function parseCliArgs(argv: string[], name: string): CliArgs {
	const result: CliArgs = {
		projectName: null,
		link: true,
	};
	const errors: string[] = [];

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
			default:
				if (arg.startsWith("-")) errors?.push(`Unknown option: ${arg}`);
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
	console.log(`
Usage: ${name} <project-file> [options]

Arguments:
  <project-file>         Mandatory project configuration file (e.g., project.yaml).

Options:
  -l, --link <true|false>  Enable or disable the final linking stage (default: true).
  -h, --help               Display this help message.
`);
	process.exit(0);
}
