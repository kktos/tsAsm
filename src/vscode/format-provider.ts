/**
 * format-provider.ts
 *
 * * Format Document and Format Selection, and so `editor.formatOnSave`: the source in columns, see `format.ts`.
 * * The settings: the file's `.editorconfig` only (`indent_style`, `tab_width` or `indent_size`, the `tsasm_*` keys, see
 *   `editorconfig.ts`), each required, as `tsasm fmt` reads them: neither VS Code's settings nor defaults, so the two
 *   can't lay a file out differently. A missing key leaves the file as it is, and the message offers to add them; an
 *   error in the `.editorconfig` too, and the message opens it at its line.
 * * Which words are mnemonics and macros comes from the projects that read the file, when it was assembled.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as vscode from "vscode";
import { addFormatKeys, EditorConfigError, formatOptionsFor, MissingFormatKeysError } from "../cli/format/editorconfig";
import { type FormatOptions, formatSource, statementTest } from "../cli/format/format";
import { type Language, language } from "./language";
import type { Projects } from "./projects";

const SELECTOR = { language: "tsasm" };

export function registerFormatting(projects: Projects): vscode.Disposable[] {
	let lang: Language | undefined;
	/** The edits formatting `document`, on the lines of `range` only when there's one: the whole file is read for its blocks. */
	const edits = (document: vscode.TextDocument, range?: vscode.Range): vscode.TextEdit[] => {
		const options = formatOptions(document, projects);
		if (!options) return [];
		lang ??= language();
		const text = document.getText();
		const { cpu, definitions } = projects.sourceContext(document.uri);
		const macros = definitions.filter(({ symbol }) => symbol.kind === "macro").map(({ symbol }) => symbol.name.toUpperCase());
		const formatted = formatSource(text, options, statementTest(text, lang, cpu, macros)).split("\n");
		const result: vscode.TextEdit[] = [];
		for (let line = 0; line < document.lineCount; line++) {
			if (range && (line < range.start.line || line > range.end.line)) continue;
			const current = document.lineAt(line);
			const next = (formatted[line] ?? current.text).replace(/\r$/, "");
			if (next !== current.text) result.push(vscode.TextEdit.replace(current.range, next));
		}
		return result;
	};
	return [
		vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, {
			provideDocumentFormattingEdits: (document) => edits(document),
		}),
		vscode.languages.registerDocumentRangeFormattingEditProvider(SELECTOR, {
			provideDocumentRangeFormattingEdits: (document, range) => edits(document, range),
		}),
	];
}

/** The `.editorconfig`'s settings: undefined, the reason shown, when it lacks one or has an error. */
function formatOptions(document: vscode.TextDocument, projects: Projects): FormatOptions | undefined {
	if (document.uri.scheme !== "file") {
		void vscode.window.showErrorMessage("Not formatted: an unsaved file has no .editorconfig to take its settings from. Save it in its project first.");
		return undefined;
	}
	try {
		return formatOptionsFor(document.uri.fsPath, readFile);
	} catch (error) {
		if (error instanceof EditorConfigError) void showEditorConfigError(error);
		else if (error instanceof MissingFormatKeysError) void offerFormatKeys(error, document.uri, projects);
		else throw error;
		return undefined;
	}
}

function readFile(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/** The error, and a button opening the `.editorconfig` at its line. */
async function showEditorConfigError(error: EditorConfigError): Promise<void> {
	const open = "Open .editorconfig";
	const choice = await vscode.window.showErrorMessage(`Not formatted, as the .editorconfig has an error: ${error.message}`, open);
	if (choice !== open) return;
	await openAt(error.file, error.line);
}

/**
 * The missing keys, and a button adding them as `tsasm fmt --init` does: to the `.editorconfig` beside the project file,
 * for the files the project reads statements from; for a file in no project, beside the workspace folder, else the file.
 */
async function offerFormatKeys(error: MissingFormatKeysError, uri: vscode.Uri, projects: Projects): Promise<void> {
	const add = "Add them to .editorconfig";
	const choice = await vscode.window.showErrorMessage(error.message, add);
	if (choice !== add) return;
	const project = projects.statementFilesOf(uri)[0];
	const dir = project ? dirname(project.project) : (vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? dirname(uri.fsPath));
	const files = [...new Set([...(project?.files ?? []), uri.fsPath])];
	try {
		const added = addFormatKeys(dir, files, readFile);
		if (!added) return;
		writeFileSync(added.path, added.text);
		await openAt(added.path, added.text.split("\n").length);
	} catch (e) {
		void vscode.window.showErrorMessage(`Not added: ${e instanceof Error ? e.message : String(e)}`);
	}
}

/** Opens `file` at `line`, from 1. */
async function openAt(file: string, line: number): Promise<void> {
	const document = await vscode.workspace.openTextDocument(file);
	const position = new vscode.Position(Math.max(0, line - 1), 0);
	await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
}
