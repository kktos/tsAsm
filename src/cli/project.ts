/**
 * project.ts
 *
 * * How a project file sets up the assembler: its CPUs and its options, the same for the CLI and the VS Code extension.
 */

import type { AssemblerOptions } from "../assembler/polyasm.types";
import handlers from "../cpu";
import type { DirectiveContext } from "../directives/directive.interface";
import type { Logger } from "../helpers/logger.class";
import { yamlparse } from "./asm-yaml";
import type { ProjectConf } from "./conf";

const textHandler = (blockContent: string, _context: DirectiveContext) => blockContent;
const yamlHandler = (blockContent: string, _context: DirectiveContext) => yamlparse(blockContent);
const jsonHandler = (blockContent: string, _context: DirectiveContext) => JSON.parse(blockContent);

/** Every CPU the CLI has: `.cpu` can switch to any of them. The project file picks the one the source starts with. */
export function projectCpus() {
	return Object.values(handlers).map((CpuHandlerClass) => new CpuHandlerClass());
}

/** The assembler's options from the project file's `input`. */
export function projectOptions(conf: ProjectConf, logger: Logger): AssemblerOptions {
	const options: AssemblerOptions = {
		logger,
		cpu: conf.input.cpu || "6502",
		rawDataProcessors: {
			default: "YAML",
			map: new Map([
				["TEXT", textHandler],
				["YAML", yamlHandler],
				["JSON", jsonHandler],
			]),
		},
	};
	if (conf.input.segments) options.segments = conf.input.segments;
	if (conf.input.options) options.options = { ...conf.input.options };
	if (conf.input.linker) options.linker = conf.input.linker;
	return options;
}
