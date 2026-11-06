/**
 * projects.ts
 *
 * * The projects of the workspace, assembled while their files change: their errors and warnings in the Problems panel,
 *   and the names in their files, for `navigation.ts`.
 * * What a project gives is `analysis.ts`'s: this is its link to VS Code.
 */

import { readFileSync } from "node:fs";
import * as vscode from "vscode";
import { type Analysis, analyse, type Diagnostic, type Files, isProjectFile } from "./analysis";
import { scanBlocks } from "./blocks";
import type { Place } from "./places";
import { RenameError, type RenameEdit, type RenameSymbol, readText, renameProjects, renameSymbol } from "./rename";
import { findReferences, type IndexEntry, type SymbolIndex, symbolKey } from "./symbol-index";

/** How long the typing stops before the projects assemble again. */
const DELAY = 300;
const PROJECT_FILES = "**/*.{yaml,yml}";

export class Projects implements vscode.Disposable {
	private readonly collection = vscode.languages.createDiagnosticCollection("tsasm");
	private readonly assembled = new vscode.EventEmitter<void>();
	private readonly disposables: vscode.Disposable[] = [this.collection, this.assembled];
	/** Fired once the projects are assembled again: their indexes changed. */
	readonly onDidAssemble = this.assembled.event;
	/** Each project's last assembly, by the project file's path. */
	private readonly analyses = new Map<string, Analysis>();
	/** Each project's last index: an assembly stopped by an error keeps the one before, its places moved by the edits since. */
	private readonly indexes = new Map<string, SymbolIndex>();
	/** Each project's namespaces, as written in its files: from their text at its last assembly. */
	private readonly namespaces = new Map<string, string[]>();
	/** The projects to assemble when the timer runs out, and whether to look for the projects again first. */
	private readonly pending = new Set<string>();
	private rediscover = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	/** The assembly running, if any. */
	private running: Promise<void> | undefined;

	constructor() {
		const watcher = vscode.workspace.createFileSystemWatcher("**/*");
		this.disposables.push(
			watcher,
			// A file open in the editor is read from its buffer: saving it changes nothing.
			watcher.onDidChange((uri) => this.isOpen(uri) || this.changed(uri)),
			watcher.onDidCreate((uri) => this.changed(uri)),
			watcher.onDidDelete((uri) => this.changed(uri)),
			vscode.workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
				if (document.uri.scheme === "file") this.edited(document.uri.fsPath, contentChanges);
				this.changed(document.uri);
			}),
			// Closed without saving, it's the disk's again.
			vscode.workspace.onDidCloseTextDocument(({ uri }) => this.changed(uri)),
			vscode.workspace.onDidChangeConfiguration((event) => event.affectsConfiguration("tsasm.project") && this.schedule(true)),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule(true)),
		);
		this.schedule(true, 0);
	}

	dispose(): void {
		clearTimeout(this.timer);
		for (const disposable of this.disposables) disposable.dispose();
	}

	/** What the name at `position` refers to, in every project that has the file. */
	entriesAt(uri: vscode.Uri, position: vscode.Position): IndexEntry[] {
		return [...this.indexes.values()].flatMap((index) => index.at(uri.fsPath, position.line + 1, position.character + 1));
	}

	/** The references, in every project, to what the name at `position` refers to, and its definitions with `includeDeclaration`. */
	referencesAt(uri: vscode.Uri, position: vscode.Position, includeDeclaration: boolean): Place[] {
		return findReferences(this.indexes.values(), this.entriesAt(uri, position), includeDeclaration);
	}

	/** The definitions in `file`, every project's. */
	definitionsIn(uri: vscode.Uri): IndexEntry[] {
		return [...this.indexes.values()].flatMap((index) => index.definitions(uri.fsPath));
	}

	/** What completion knows of the projects that read `uri`: their CPU, their definitions, their namespaces. */
	sourceContext(uri: vscode.Uri): { cpu?: string; definitions: IndexEntry[]; namespaces: string[] } {
		const projects = [...this.analyses].filter(([, analysis]) => analysis.files.has(uri.fsPath));
		const definitions = projects.flatMap(([project]) => this.indexes.get(project)?.definitions() ?? []);
		const namespaces = [...new Set(projects.flatMap(([project]) => this.namespaces.get(project) ?? []))];
		const cpu = projects.map(([, analysis]) => analysis.cpu).find((name) => name !== undefined);
		return cpu === undefined ? { definitions, namespaces } : { cpu, definitions, namespaces };
	}

	/** Every project's definitions, and the namespaces of their source files, from their text as it is now. */
	workspaceDefinitions(): { definitions: IndexEntry[]; namespaces: { name: string; place: Place }[] } {
		const files = editorFiles();
		const sources = new Set([...this.analyses.values()].flatMap((analysis) => [...analysis.sources]));
		const namespaces = [...sources].flatMap((file) => {
			const text = readText(files, file);
			if (text === undefined) return [];
			return scanBlocks(text).flatMap(({ kind, name, nameStart, nameEnd }) =>
				kind === "namespace" && name && nameStart && nameEnd
					? [{ name, place: { file, line: nameStart.line, column: nameStart.column, endColumn: nameEnd.column } }]
					: [],
			);
		});
		return { definitions: [...this.indexes.values()].flatMap((index) => index.definitions()), namespaces };
	}

	/** Where the symbol at `position` can be renamed, its name there: refused, saying why, where it can't. */
	async prepareRename(uri: vscode.Uri, position: vscode.Position): Promise<{ place: Place; placeholder: string }> {
		const symbol = await this.renameSymbol(uri, position);
		return { place: symbol.place, placeholder: symbol.name };
	}

	/**
	 * The edits renaming the symbol at `position` to `typed`, those found in what the assembly didn't read to confirm:
	 * refused when, assembled with them, a project fails or a name refers to something else.
	 */
	async renameEdits(uri: vscode.Uri, position: vscode.Position, typed: string): Promise<RenameEdit[]> {
		const symbol = await this.renameSymbol(uri, position);
		const projects = [...this.indexes].map(([path, index]) => ({ path, index, sources: this.analyses.get(path)?.sources ?? [] }));
		return renameProjects(projects, symbol, typed, editorFiles(), relative);
	}

	/** The symbol at `position`, once the projects are assembled from the text as it is: refused while one doesn't assemble. */
	private async renameSymbol(uri: vscode.Uri, position: vscode.Position): Promise<RenameSymbol> {
		await this.settled();
		const file = uri.fsPath;
		const entries = this.entriesAt(uri, position);
		const keys = new Set(entries.map(symbolKey));
		for (const [project, analysis] of this.analyses) {
			if (analysis.index || !(analysis.files.has(file) || (this.indexes.get(project)?.entriesOf(keys).length ?? 0) > 0)) continue;
			throw new RenameError(
				`${relative(project)} doesn't assemble: fix its errors first, else the names written since its last assembly would be missed.`,
			);
		}
		const files = editorFiles();
		return renameSymbol([...this.indexes.values()], entries, position.character + 1, (path) => readText(files, path), relative);
	}

	/** Waits for the assembly the last edits are waiting for, if any. */
	private async settled(): Promise<void> {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
			this.running = this.run();
		}
		await this.running;
	}

	/** The indexes' places in `file` follow its edits, applied in order. */
	private edited(file: string, changes: readonly vscode.TextDocumentContentChangeEvent[]): void {
		for (const change of changes) {
			const { start, end } = change.range;
			const edit = {
				start: { line: start.line + 1, column: start.character + 1 },
				end: { line: end.line + 1, column: end.character + 1 },
				text: change.text,
			};
			for (const index of this.indexes.values()) index.shift(file, edit);
		}
	}

	private isOpen(uri: vscode.Uri): boolean {
		return vscode.workspace.textDocuments.some((document) => document.uri.toString() === uri.toString());
	}

	/** A file changed: the projects that read it assemble again, and a YAML file may be a project file. */
	private changed(uri: vscode.Uri): void {
		if (uri.scheme !== "file") return;
		const path = uri.fsPath;
		for (const [project, analysis] of this.analyses) if (analysis.files.has(path)) this.pending.add(project);
		const isYaml = /\.ya?ml$/i.test(path);
		if (isYaml || this.pending.size > 0) this.schedule(isYaml);
	}

	private schedule(rediscover: boolean, delay = DELAY): void {
		this.rediscover ||= rediscover;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.running = this.run();
		}, delay);
	}

	private async run(): Promise<void> {
		this.timer = undefined;
		const files = editorFiles();
		if (this.rediscover) {
			this.rediscover = false;
			const projects = await findProjects(files);
			for (const project of this.analyses.keys()) {
				if (projects.includes(project)) continue;
				this.analyses.delete(project);
				this.indexes.delete(project);
				this.namespaces.delete(project);
			}
			for (const project of projects) if (!this.analyses.has(project)) this.pending.add(project);
		}
		for (const project of this.pending) {
			const analysis = safeAnalyse(project, files);
			this.analyses.set(project, analysis);
			if (analysis.index) this.indexes.set(project, analysis.index);
			this.namespaces.set(project, namespacesOf(files, analysis.sources));
		}
		this.pending.clear();
		this.publish();
		this.assembled.fire();
	}

	/** Every project's diagnostics, by file: a file in two projects gets an error both give once. */
	private publish(): void {
		const byFile = new Map<string, Map<string, vscode.Diagnostic>>();
		for (const { diagnostics } of this.analyses.values()) {
			for (const diagnostic of diagnostics) {
				const inFile = byFile.get(diagnostic.file) ?? new Map<string, vscode.Diagnostic>();
				byFile.set(diagnostic.file, inFile);
				inFile.set(JSON.stringify(diagnostic), toVscode(diagnostic));
			}
		}
		this.collection.clear();
		for (const [file, diagnostics] of byFile) this.collection.set(vscode.Uri.file(file), [...diagnostics.values()]);
	}
}

/** The editor's buffer of a file open in it, saved or not, else the disk's file. */
function editorFiles(): Files {
	const open = new Map(vscode.workspace.textDocuments.filter(({ uri }) => uri.scheme === "file").map((document) => [document.uri.fsPath, document]));
	return {
		readText: (path) => open.get(path)?.getText() ?? readFileSync(path, "utf-8"),
		readBytes: (path) => Array.from(readFileSync(path)),
	};
}

/** The namespaces opened in `sources`, as written. */
function namespacesOf(files: Files, sources: Iterable<string>): string[] {
	const names = new Map<string, string>();
	for (const file of sources) {
		const text = readText(files, file);
		if (text === undefined) continue;
		for (const { kind, name } of scanBlocks(text)) if (kind === "namespace" && name && !names.has(name.toUpperCase())) names.set(name.toUpperCase(), name);
	}
	return [...names.values()];
}

const relative = (path: string) => vscode.workspace.asRelativePath(path);

/** The `tsasm.project` setting of each workspace folder, relative to it, else the workspace's YAML files with an `input.source`. */
async function findProjects(files: Files): Promise<string[]> {
	const projects = new Set<string>();
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const setting = vscode.workspace.getConfiguration("tsasm", folder).get<string | string[]>("project");
		const paths = typeof setting === "string" ? [setting] : (setting ?? []);
		for (const path of paths.filter((path) => path.trim() !== "")) projects.add(vscode.Uri.joinPath(folder.uri, path).fsPath);
		if (paths.length > 0) continue;
		const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, PROJECT_FILES), "**/node_modules/**");
		for (const uri of found) if (readsAsProject(files, uri.fsPath)) projects.add(uri.fsPath);
	}
	return [...projects].sort();
}

function readsAsProject(files: Files, path: string): boolean {
	try {
		return isProjectFile(files.readText(path));
	} catch {
		return false;
	}
}

/** The analysis never throws, but an extension that stops working without a word would be worse than this. */
function safeAnalyse(project: string, files: Files): Analysis {
	try {
		return analyse(project, files);
	} catch (e) {
		const message = `The analysis of this project failed: ${e instanceof Error ? e.message : e}`;
		return {
			files: new Set([project]),
			sources: new Set(),
			diagnostics: [{ file: project, line: 1, column: 1, endColumn: 2, message, severity: "error", related: [] }],
		};
	}
}

function range({ line, column, endColumn }: Place): vscode.Range {
	return new vscode.Range(line - 1, column - 1, line - 1, endColumn - 1);
}

function toVscode(diagnostic: Diagnostic): vscode.Diagnostic {
	const severity = diagnostic.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
	const result = new vscode.Diagnostic(range(diagnostic), diagnostic.message, severity);
	result.source = "tsasm";
	result.relatedInformation = diagnostic.related.map(
		(related) => new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.file(related.file), range(related)), related.message),
	);
	return result;
}
