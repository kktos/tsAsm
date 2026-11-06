/**
 * language.ts
 *
 * * What the language has, for completion and signature help: each CPU's mnemonics and directives, the directives,
 *   the system functions and variables, the `.option` names. From the assembler's code, so they follow it.
 * * Without the vscode module, so it can be tested.
 */

import { DEFAULT_OPTIONS, type OptionName, optionValuesText } from "../assembler/options";
import { Assembler, SYSTEM_VARIABLES } from "../assembler/polyasm";
import { projectCpus } from "../cli/project";
import { Logger } from "../helpers/logger.class";
import type { LogSink } from "../helpers/logsink.interface";

export interface Cpu {
	/** Its name, `65C02`. */
	name: string;
	/** Its names in upper case, its aliases too: what `.cpu` takes. */
	names: string[];
	/** In upper case. */
	mnemonics: string[];
	/** Its own directives, in upper case: the 65816's `NATIVE`. */
	directives: string[];
}

export interface SystemFunction {
	/** In upper case, without its dot. */
	name: string;
	parameters: readonly string[];
	minArgs: number;
	maxArgs: number;
	description: string;
}

export interface Language {
	cpus: Cpu[];
	/** Every CPU's directives, in upper case, without their dot. */
	directives: string[];
	functions: SystemFunction[];
	/** In upper case, without their dot. */
	variables: { name: string; description: string }[];
	/** The `.option` names, and the values each takes. */
	options: { name: string; values: string }[];
}

const SILENT: LogSink<null> = { log() {}, warn() {}, error() {}, pushConfig() {}, popConfig() {}, getConfigDepth: () => 0 };

/** The language, from the assembler with every CPU the CLI has. */
export function language(): Language {
	const cpus = projectCpus();
	const assembler = new Assembler(
		cpus,
		{ fullpath: "", filename: "", readSourceFile: () => "", readBinaryFile: () => [] },
		{ logger: new Logger({ sink: SILENT, enabled: false }) },
	);
	const own = new Set(cpus.flatMap((cpu) => Object.keys(cpu.directives ?? {})));
	return {
		cpus: cpus.map((cpu) => ({
			name: cpu.cpuType,
			names: [cpu.cpuType, ...(cpu.aliases ?? [])].map((name) => name.toUpperCase()),
			mnemonics: [...(cpu.mnemonics ?? [])],
			directives: Object.keys(cpu.directives ?? {}),
		})),
		directives: assembler.parser.directiveNames().filter((name) => /^[A-Z]\w*$/.test(name) && !own.has(name)),
		functions: assembler.expressionEvaluator.functionDispatcher.list(),
		variables: Object.entries(SYSTEM_VARIABLES).map(([name, description]) => ({ name, description })),
		options: (Object.keys(DEFAULT_OPTIONS) as OptionName[]).map((name) => ({ name, values: optionValuesText(name) })),
	};
}
