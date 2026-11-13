/**
 * fmt.ts
 *
 * * `tsasm fmt <project-file>`: the project's files laid out in columns, as the VS Code extension does, with the same
 *   code (`format/`), the same settings (`.editorconfig` only, each required) and the same words: the project is
 *   assembled, and its CPU, its macros and the files it reads statements from are the extension's.
 * * `--check` writes nothing, lists each file not formatted at its first line that would change, and fails.
 * * `--init` adds the settings the files lack to the `.editorconfig` beside the project file, as the extension's button.
 * * A file's line endings and byte order mark are kept, and a file is written only when it changes.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { Assembler } from "../assembler/polyasm";
import { Logger } from "../helpers/logger.class";
import type { LogSink } from "../helpers/logsink.interface";
import { AsmError } from "../utils/error.utils";
import { readConf } from "./conf";
import { NodeFileHandler } from "./file";
import { addFormatKeys, EditorConfigError, formatOptionsFor, MissingFormatKeysError } from "./format/editorconfig";
import { formatSource, type StatementCpu, statementTest } from "./format/format";
import { projectCpus, projectOptions } from "./project";

export interface FmtArgs {
	projectFile: string;
	check: boolean;
	init: boolean;
}

/** Where `tsasm fmt` writes: what it did to `log`, what went wrong to `error`. */
export interface FmtOutput {
	log(message: string): void;
	error(message: string): void;
}

export const FMT_HELP = `
Usage: tsasm fmt <project-file> [--check | --init]

Lays out the files the project reads statements from in columns, as the VS Code extension does: the project is
assembled, for its CPU and its macros. The settings are the files' .editorconfig keys, each required:
indent_style, tab_width (indent_size with spaces), tsasm_opcode_column, tsasm_operand_column,
tsasm_comment_column, tsasm_indent_blocks.

Options:
  --check      Write nothing: list the files not formatted, and fail if there's one.
  --init       Add the keys the files lack to the .editorconfig beside the project file.
  -h, --help   Display this help message.
`;

/** `tsasm fmt`'s arguments, after `fmt`: a string, the errors, when they're wrong; undefined for `--help`. */
export function parseFmtArgs(argv: string[]): FmtArgs | string[] | undefined {
	const errors: string[] = [];
	const args: FmtArgs = { projectFile: "", check: false, init: false };
	for (const arg of argv) {
		if (arg === "-h" || arg === "--help") return undefined;
		if (arg === "--check") args.check = true;
		else if (arg === "--init") args.init = true;
		else if (arg.startsWith("-")) errors.push(`Unknown option for fmt: ${arg}. The options are --check and --init.`);
		else if (args.projectFile) errors.push(`Unexpected argument: ${arg}. The project file is already '${args.projectFile}'.`);
		else args.projectFile = arg;
	}
	if (args.check && args.init) errors.push("--check and --init can't be given together: --init writes the .editorconfig.");
	if (!args.projectFile && errors.length === 0) errors.push("Missing the project file: tsasm fmt <project-file>.");
	return errors.length > 0 ? errors : args;
}

/** What the extension knows of a project from its assembly: its CPU, its macros, the files it reads statements from. */
interface ProjectWords {
	cpu: string | undefined;
	macros: string[];
	files: string[];
}

const SILENT: LogSink<null> = { log() {}, warn() {}, error() {}, pushConfig() {}, popConfig() {}, getConfigDepth: () => 0 };

/** Runs `tsasm fmt`: the exit status, 0 when everything went well. */
export function runFmt(args: FmtArgs, output: FmtOutput): number {
	const project = assembleProject(args.projectFile, output);
	if (!project) return 1;
	const show = (file: string) => relative(process.cwd(), file) || file;

	if (args.init) {
		try {
			const added = addFormatKeys(dirname(resolve(args.projectFile)), project.files, readFile);
			if (!added) {
				output.log("Nothing to add: the .editorconfig sets every key for the project's files.");
				return 0;
			}
			writeFileSync(added.path, added.text);
			output.log(`${show(added.path)}: the format keys added.`);
			return 0;
		} catch (e) {
			output.error(`Not added: ${e instanceof Error ? e.message : String(e)}`);
			return 1;
		}
	}

	const cpus: StatementCpu[] = projectCpus().map((cpu) => ({
		names: [cpu.cpuType, ...(cpu.aliases ?? [])].map((name) => name.toUpperCase()),
		mnemonics: [...(cpu.mnemonics ?? [])],
	}));
	let failed = 0;
	let changed = 0;
	// An .editorconfig's error is told once, whatever the files it's for.
	const told = new Set<string>();
	for (const file of project.files) {
		const result = formatFile(file, { cpus }, project, args.check, show);
		if (result.error !== undefined) {
			if (!told.has(result.error)) output.error(result.error);
			told.add(result.error);
			failed++;
		} else if (result.line !== undefined) {
			changed++;
			output.log(args.check ? `${show(file)}:${result.line}: not formatted` : `${show(file)}: formatted`);
		}
	}
	const count = (n: number) => `${n} file${n === 1 ? "" : "s"}`;
	const unchanged = project.files.length - changed - failed;
	const errors = failed > 0 ? `, ${count(failed)} in error` : "";
	if (args.check) output.log(`${count(changed)} not formatted, ${count(unchanged)} formatted${errors}.`);
	else output.log(`${count(changed)} formatted, ${count(unchanged)} unchanged${errors}.`);
	return failed > 0 || (args.check && changed > 0) ? 1 : 0;
}

/** Assembles the project as the CLI does, without linking or writing anything: undefined, the error told, when it fails. */
function assembleProject(projectFile: string, output: FmtOutput): ProjectWords | undefined {
	const fileHandler = new NodeFileHandler();
	try {
		const { conf, errors } = readConf(fileHandler, projectFile);
		if (errors) {
			for (const error of errors) output.error(`${projectFile}: ${error.path}: ${error.message}`);
			return undefined;
		}
		fileHandler.basedir = `${resolve(dirname(projectFile), dirname(conf.input.source))}/`;
		const options = projectOptions(conf, new Logger({ sink: SILENT, enabled: false }), relative(fileHandler.basedir, resolve(projectFile)));
		const files = new Set<string>();
		const sourceName = basename(conf.input.source);
		const sourcePath = resolve(fileHandler.basedir, sourceName);
		// As the extension: the files the assembler names, relative to the source's folder; none is the source.
		options.onStatement = ({ location: { file } }) => files.add(file ? resolve(fileHandler.basedir, file) : sourcePath);
		const assembler = new Assembler(projectCpus(), fileHandler, options);
		assembler.assemble(fileHandler.readSourceFile(sourceName));
		const macros = [...assembler.macroHandler.macroDefinitions.values()].map(({ name }) => name.toUpperCase());
		return { cpu: options.cpu, macros, files: [...files].sort() };
	} catch (e) {
		output.error(e instanceof AsmError ? e.format() : `Error: ${e instanceof Error ? e.message : String(e)}`);
		output.error("Not formatted: the project doesn't assemble.");
		return undefined;
	}
}

/** Formats `file`, writing it unless `check`: the first line (from 1) that changes, if any, or the error. */
function formatFile(
	file: string,
	language: { cpus: StatementCpu[] },
	project: ProjectWords,
	check: boolean,
	show: (file: string) => string,
): { line?: number; error?: string } {
	let options: ReturnType<typeof formatOptionsFor>;
	try {
		options = formatOptionsFor(file, readFile);
	} catch (e) {
		if (e instanceof EditorConfigError) return { error: `${show(e.file)}:${e.line}: ${e.message}` };
		if (e instanceof MissingFormatKeysError)
			return { error: `${show(file)}: no .editorconfig sets ${e.keys.join(", ")} for it: tsasm fmt --init adds them.` };
		throw e;
	}
	let source: string;
	try {
		source = readFileSync(file, "utf8");
	} catch (e) {
		return { error: `${show(file)}: can't be read: ${e instanceof Error ? e.message : String(e)}` };
	}
	// As VS Code gives it to the extension: without its byte order mark, kept when it's written.
	const bom = source.startsWith("﻿") ? "﻿" : "";
	const text = source.slice(bom.length);
	const formatted = formatSource(text, options, statementTest(text, language, project.cpu, project.macros));
	if (formatted === text) return {};
	const before = text.split("\n");
	const after = formatted.split("\n");
	const line = after.findIndex((current, index) => current !== before[index]) + 1;
	if (!check) {
		try {
			writeFileSync(file, bom + formatted);
		} catch (e) {
			return { error: `${show(file)}: can't be written: ${e instanceof Error ? e.message : String(e)}` };
		}
	}
	return { line };
}

function readFile(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}
