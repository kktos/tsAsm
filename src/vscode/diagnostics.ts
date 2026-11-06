/**
 * diagnostics.ts
 *
 * * The projects of the workspace, assembled while their files change, their errors and warnings in the Problems panel.
 * * What a project gives is `analysis.ts`'s: this is its link to VS Code.
 */

import { readFileSync } from "node:fs";
import * as vscode from "vscode";
import { type Analysis, analyse, type Diagnostic, type Files, isProjectFile, type Place } from "./analysis";

/** How long the typing stops before the projects assemble again. */
const DELAY = 300;
const PROJECT_FILES = "**/*.{yaml,yml}";

export class ProjectDiagnostics implements vscode.Disposable {
	private readonly collection = vscode.languages.createDiagnosticCollection("tsasm");
	private readonly disposables: vscode.Disposable[] = [this.collection];
	/** Each project's last assembly, by the project file's path. */
	private readonly analyses = new Map<string, Analysis>();
	/** The projects to assemble when the timer runs out, and whether to look for the projects again first. */
	private readonly pending = new Set<string>();
	private rediscover = false;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		const watcher = vscode.workspace.createFileSystemWatcher("**/*");
		this.disposables.push(
			watcher,
			// A file open in the editor is read from its buffer: saving it changes nothing.
			watcher.onDidChange((uri) => this.isOpen(uri) || this.changed(uri)),
			watcher.onDidCreate((uri) => this.changed(uri)),
			watcher.onDidDelete((uri) => this.changed(uri)),
			vscode.workspace.onDidChangeTextDocument(({ document }) => this.changed(document.uri)),
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
		this.timer = setTimeout(() => void this.run(), delay);
	}

	private async run(): Promise<void> {
		this.timer = undefined;
		const files = editorFiles();
		if (this.rediscover) {
			this.rediscover = false;
			const projects = await findProjects(files);
			for (const project of this.analyses.keys()) if (!projects.includes(project)) this.analyses.delete(project);
			for (const project of projects) if (!this.analyses.has(project)) this.pending.add(project);
		}
		for (const project of this.pending) this.analyses.set(project, safeAnalyse(project, files));
		this.pending.clear();
		this.publish();
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
		return { files: new Set([project]), diagnostics: [{ file: project, line: 1, column: 1, endColumn: 2, message, severity: "error", related: [] }] };
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
