/**
 * analysis.ts
 *
 * * What the VS Code extension knows of a project: it assembles it as the CLI does, and reports its errors and warnings.
 * * Without the vscode module, so it can be tested, and moved into a language server.
 */

import { basename, dirname, join, relative } from "node:path";
import { Assembler } from "../assembler/polyasm";
import type { Emission, FileHandler, ListedLine, SymbolReference } from "../assembler/polyasm.types";
import { yamlparse } from "../cli/asm-yaml";
import { readConf } from "../cli/conf";
import { scanBlocks } from "../cli/format/blocks";
import { projectCpus, projectOptions } from "../cli/project";
import { Logger } from "../helpers/logger.class";
import type { LogSink } from "../helpers/logsink.interface";
import { AsmError, type DefinitionSite, type IncludeSite, type SourceLocation } from "../utils/error.utils";
import { addressHints } from "./addresses";
import { nameSpan, type Place, tokenSpan } from "./places";
import { SymbolIndex } from "./symbol-index";
import { unreadRuns } from "./unread";

/** How the analysis reads a file, by its absolute path: the editor's buffer when it's open, else the disk. Throws when there's none. */
export interface Files {
	readText(path: string): string;
	readBytes(path: string): number[];
}

export interface Diagnostic extends Place {
	message: string;
	severity: "error" | "warning";
	/** The other places it's about: a note's, the macro calls and `.include` directives that led to it. */
	related: (Place & { message: string })[];
}

export interface Analysis {
	/** Every file the assembly read, or tried to, the project file too: a change to one of them assembles again. */
	files: Set<string>;
	diagnostics: Diagnostic[];
	/** Where the names are and what they refer to, when it assembled: an assembly stopped by an error gives none. */
	index?: SymbolIndex;
	/** The source files it read, the project file left out. */
	sources: Set<string>;
	/** The files it read statements from, the data a `.define … from` reads left out: the files to format. */
	statementFiles?: Set<string>;
	/** The CPU the source starts with, from the project file. */
	cpu?: string;
	/** Where the CLI writes the listing, from the project file: what the listing's tab is named. */
	listingPath?: string;
}

/** A YAML file is a project file when it has an `input.source`. */
export function isProjectFile(text: string): boolean {
	try {
		const conf = yamlparse(text) as { input?: { source?: unknown } } | null;
		return typeof conf?.input?.source === "string";
	} catch {
		return false;
	}
}

/** Assembles the project of `projectPath`, an absolute path, as the CLI does, without writing anything. */
export function analyse(projectPath: string, files: Files): Analysis {
	const reader = new FileReader(files);
	const warnings = new WarningSink();
	const report = new Report(reader);

	const conf = readProject(projectPath, reader, report);
	if (!conf) return { files: reader.paths, diagnostics: report.diagnostics, sources: new Set() };

	// As the CLI: the source's paths are relative to its directory, the project file's to the project file.
	const handler = new AnalysisFileHandler(join(dirname(projectPath), dirname(conf.input.source)), reader);
	const sourceName = basename(conf.input.source);
	const sourcePath = join(handler.basedir, sourceName);
	let source: string;
	try {
		source = handler.readSourceFile(sourceName);
	} catch (e) {
		const line = keyLine(reader.text(projectPath) ?? "", "input.source");
		report.add(new AsmError(`Can't read the source '${conf.input.source}': ${e instanceof Error ? e.message : e}`, { line }), "", projectPath);
		return { files: reader.paths, diagnostics: report.diagnostics, sources: new Set() };
	}
	const references: SymbolReference[] = [];
	const emissions: Emission[] = [];
	const listed: ListedLine[] = [];
	// The lines pass 2 read, by the file the assembler names.
	const read = new Map<string | undefined, Set<number>>();
	let index: SymbolIndex | undefined;
	let statementFiles: Set<string> | undefined;
	let cpu: string | undefined;
	try {
		// Located as the source's files are, relative to its directory: the project file's symbols are defined in it.
		const options = projectOptions(conf, new Logger({ sink: warnings, enabled: false }), relative(handler.basedir, projectPath));
		cpu = options.cpu;
		options.onSymbolReference = (reference) => references.push(reference);
		options.onEmit = (emission) => emissions.push(emission);
		options.onListing = (line) => listed.push(line);
		options.onStatement = ({ location: { file, line } }) => {
			const lines = read.get(file) ?? new Set<number>();
			read.set(file, lines);
			lines.add(lineNumber(line));
		};
		new Assembler(projectCpus(), handler, options).assemble(source);
		const path = (file: string | undefined) => (file ? join(handler.basedir, file) : sourcePath);
		index = buildIndex(references, emissions, listed, path, reader);
		addUnread(index, read, path, reader, projectPath);
		statementFiles = new Set([...read.keys()].map(path));
	} catch (e) {
		// An error found before the assembly starts, without a line (a segment of the project file), is the project file's.
		const error = e instanceof AsmError ? e : new AsmError(e instanceof Error ? e.message : String(e));
		report.add(error, handler.basedir, error.location.line === undefined ? projectPath : sourcePath);
	}
	for (const warning of warnings.warnings) report.add(warning, handler.basedir, sourcePath);
	const sources = new Set(reader.textPaths().filter((path) => path !== projectPath));
	const analysis: Analysis = { files: reader.paths, diagnostics: report.diagnostics, sources };
	if (index) analysis.index = index;
	if (statementFiles) analysis.statementFiles = statementFiles;
	if (cpu) analysis.cpu = cpu;
	// As the CLI names it.
	analysis.listingPath = join(dirname(projectPath), conf.output?.listing?.path ?? `${conf.input.source}.lst`);
	return analysis;
}

/**
 * The index of the references, each at its name, its target at the name of its definition, of the lines' addresses
 * and of the listing: `path` makes a file absolute.
 */
function buildIndex(
	references: SymbolReference[],
	emissions: Emission[],
	listed: ListedLine[],
	path: (file: string | undefined) => string,
	reader: FileReader,
): SymbolIndex {
	const index = new SymbolIndex();
	const lineText = (file: string, line: number) => reader.text(file)?.split("\n")[line - 1]?.replace(/\r$/, "") ?? "";
	const locate = (location: SourceLocation, name?: string): Place => {
		const file = path(location.file);
		const line = lineNumber(location.line);
		const text = lineText(file, line);
		const column = location.column ?? 1;
		const [start, end] = name === undefined ? tokenSpan(text, column) : nameSpan(text, column, name);
		return { file, line, column: start, endColumn: end };
	};
	for (const reference of references) {
		const { at, definition } = reference;
		let { symbol } = reference;
		const target = locate(symbol.site.location, symbol.name);
		const text = lineText(target.file, target.line);
		const written = text.slice(target.column - 1, target.endColumn - 1) || symbol.name;
		// The assembler keeps a macro's parameters in upper case: as written, from its line.
		if (symbol.parameters) symbol = { ...symbol, parameters: symbol.parameters.map((parameter) => spelling(parameter, text)) };
		index.add({ place: definition ? target : locate(at), definition, symbol, target, written });
	}
	const chainOf = ({ includeStack }: DefinitionSite) => includeStack.filter(({ line }) => line !== undefined).map((call) => locate(call));
	const located = emissions.map(({ site, address, bytes }) => ({ place: locate(site.location), chain: chainOf(site), address, bytes }));
	for (const hint of addressHints(located, index.definitions())) index.addHint(hint);
	index.listing = listed.map(({ text, site }) => (site ? { text, place: locate(site.location), chain: chainOf(site) } : { text, chain: [] }));
	return index;
}

/** A location's line: a number, or the text `12.3` for a line in a macro's body. */
const lineNumber = (line: number | string | undefined) => Math.max(1, Number(String(line ?? 1).split(".")[0]) || 1);

/** Adds to `index` the lines of each source file pass 2 didn't read, `read` the lines it read by the file it names. */
function addUnread(
	index: SymbolIndex,
	read: Map<string | undefined, Set<number>>,
	path: (file: string | undefined) => string,
	reader: FileReader,
	projectPath: string,
) {
	const byPath = new Map<string, Set<number>>();
	for (const [file, lines] of read) byPath.set(path(file), new Set([...(byPath.get(path(file)) ?? []), ...lines]));
	for (const file of reader.textPaths()) {
		const text = reader.text(file);
		if (file === projectPath || text === undefined) continue;
		const lines = text.split("\n");
		for (const { start, end } of unreadRuns(text, byPath.get(file) ?? new Set(), scanBlocks(text))) {
			for (let line = start; line <= end; line++) {
				const length = lines[line - 1]?.replace(/\r$/, "").length ?? 0;
				index.addUnread({ file, line, column: 1, endColumn: length + 1 });
			}
		}
	}
}

/** `name` as `text` writes it, in any case: `...REST` is `...rest` in `.macro m ...rest`. */
function spelling(name: string, text: string): string {
	const match = new RegExp(`(?<![\\w.])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "i").exec(text);
	return match ? match[0] : name;
}

/** The project file, read and checked: its errors and warnings are reported in it. */
function readProject(projectPath: string, reader: FileReader, report: Report) {
	try {
		const { conf, errors, warnings } = readConf(new AnalysisFileHandler("", reader), projectPath);
		const lineOf = (path: string) => keyLine(reader.text(projectPath) ?? "", path);
		for (const { path, message } of warnings ?? []) report.add(AsmError.warning(`${path}: ${message}`, { line: lineOf(path) }), "", projectPath);
		if (!errors) return conf;
		for (const { path, message } of errors) report.add(new AsmError(`${path}: ${message}`, { line: lineOf(path) }), "", projectPath);
	} catch (e) {
		report.add(e instanceof AsmError ? e : new AsmError(String(e)), "", projectPath);
	}
	return undefined;
}

/** The line of a setting in the project file, by its last key (`input.cpu`: the first `cpu:`), else the first line. */
function keyLine(text: string, path: string): number {
	const key = path
		.split(".")
		.map((part) => part.replace(/\[\d+\]$/, ""))
		.findLast((part) => /^[\w-]+$/.test(part) && part !== "_");
	const index = key ? text.split("\n").findIndex((line) => new RegExp(`^\\s*(?:-\\s+)?${key}\\s*:`).test(line)) : -1;
	return index + 1 || 1;
}

/** The files read, by absolute path, and their text, to find where a token ends. */
class FileReader {
	public readonly paths = new Set<string>();
	private readonly texts = new Map<string, string>();

	constructor(private readonly files: Files) {}

	readText(path: string): string {
		this.paths.add(path);
		const text = this.files.readText(path);
		this.texts.set(path, text);
		return text;
	}

	readBytes(path: string): number[] {
		this.paths.add(path);
		return this.files.readBytes(path);
	}

	text(path: string): string | undefined {
		return this.texts.get(path);
	}

	/** The files read as text. */
	textPaths(): string[] {
		return [...this.texts.keys()];
	}
}

/** The CLI's `NodeFileHandler`, reading through `Files`: a path is relative to `basedir`, an included one to the file including it. */
class AnalysisFileHandler implements FileHandler {
	public fullpath = "";
	public filename = "";

	constructor(
		public readonly basedir: string,
		private readonly reader: FileReader,
	) {}

	readSourceFile(filename: string, from?: string): string {
		return this.reader.readText(this.locate(filename, from));
	}

	readBinaryFile(filename: string, from?: string): number[] {
		return this.reader.readBytes(this.locate(filename, from));
	}

	private locate(filename: string, from?: string): string {
		this.filename = filename.split("/").at(-1) as string;
		this.fullpath = from ? join(dirname(from), filename) : filename;
		// As the CLI joins them: a path starting with "/" is still relative.
		return join(this.basedir, this.fullpath);
	}
}

/** The warnings the assembler reports, each an AsmError. */
class WarningSink implements LogSink<null> {
	public readonly warnings: AsmError[] = [];

	log(): void {}
	warn(message: unknown): void {
		if (message instanceof AsmError) this.warnings.push(message);
		else this.warnings.push(AsmError.warning(String(message)));
	}
	error(message: unknown): void {
		this.warn(message);
	}
	pushConfig(): void {}
	popConfig(): void {}
	getConfigDepth(): number {
		return 0;
	}
}

/**
 * The diagnostics, once each: a warning in a macro body, given at each call, is one diagnostic at its line, its
 * related places those of every call.
 */
class Report {
	public readonly diagnostics: Diagnostic[] = [];
	private readonly byKey = new Map<string, Diagnostic>();

	constructor(private readonly reader: FileReader) {}

	/** An error located in the assembly's files, relative to `basedir`; one without a file is in `file`. */
	add(error: AsmError, basedir: string, file: string): void {
		const place = (location: SourceLocation) => this.place(location, basedir, file);
		const diagnostic: Diagnostic = {
			...place(error.location),
			message: error.message,
			severity: error.severity,
			related: [
				...error.notes.map((note) => ({ ...place(note.location), message: note.message })),
				...error.macroStack.map((call) => ({ ...place(call.calledAt), message: `in macro ${call.name}, called here` })),
				...error.includeStack.map((site) => ({ ...place(site), message: siteMessage(site) })),
			],
		};
		const key = JSON.stringify([diagnostic.file, diagnostic.line, diagnostic.column, diagnostic.severity, diagnostic.message]);
		const same = this.byKey.get(key);
		if (!same) {
			this.byKey.set(key, diagnostic);
			this.diagnostics.push(diagnostic);
			return;
		}
		const known = new Set(same.related.map((related) => JSON.stringify(related)));
		same.related.push(...diagnostic.related.filter((related) => !known.has(JSON.stringify(related))));
	}

	private place({ file, line, column }: SourceLocation, basedir: string, defaultFile: string): Place {
		const path = file === undefined ? defaultFile : join(basedir, file);
		// A macro body's line the assembler couldn't place, "4.2": the call's line.
		const lineNumber = Math.max(1, Number(String(line ?? 1).split(".")[0]) || 1);
		const text = this.reader.text(path)?.split("\n")[lineNumber - 1]?.replace(/\r$/, "") ?? "";
		const [start, end] = tokenSpan(text, column);
		return { file: path, line: lineNumber, column: start, endColumn: end };
	}
}

function siteMessage(site: IncludeSite): string {
	return site.macro !== undefined ? `in macro ${site.macro}, called here` : "included here";
}
