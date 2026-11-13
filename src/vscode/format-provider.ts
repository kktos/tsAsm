/**
 * format-provider.ts
 *
 * * Format Document and Format Selection, and so `editor.formatOnSave`: the source in columns, see `format.ts`.
 * * The settings: the file's `.editorconfig` (`indent_style`, `tab_width`, `indent_size`, the `tsasm_*` keys, see
 *   `editorconfig.ts`), else the `tsasm.format.*` settings for the columns and the editor's tabs or spaces. An error in
 *   the `.editorconfig` leaves the file as it is, and is shown with a way to open it at its line.
 * * Which words are mnemonics and macros comes from the projects that read the file, when it was assembled.
 */

import { readFileSync } from "node:fs";
import * as vscode from "vscode";
import { EditorConfigError, editorConfigFor, formatSettings } from "../cli/format/editorconfig";
import { DEFAULT_FORMAT, type FormatOptions, formatSource, statementTest } from "../cli/format/format";
import { type Language, language } from "./language";
import type { Projects } from "./projects";

const SELECTOR = { language: "tsasm" };

export function registerFormatting(projects: Projects): vscode.Disposable[] {
	let lang: Language | undefined;
	/** The edits formatting `document`, on the lines of `range` only when there's one: the whole file is read for its blocks. */
	const edits = (document: vscode.TextDocument, editor: vscode.FormattingOptions, range?: vscode.Range): vscode.TextEdit[] => {
		lang ??= language();
		const text = document.getText();
		const { cpu, definitions } = projects.sourceContext(document.uri);
		const macros = definitions.filter(({ symbol }) => symbol.kind === "macro").map(({ symbol }) => symbol.name.toUpperCase());
		let options: FormatOptions;
		try {
			options = formatOptions(document, editor);
		} catch (error) {
			if (!(error instanceof EditorConfigError)) throw error;
			void showEditorConfigError(error);
			return [];
		}
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
			provideDocumentFormattingEdits: (document, options) => edits(document, options),
		}),
		vscode.languages.registerDocumentRangeFormattingEditProvider(SELECTOR, {
			provideDocumentRangeFormattingEdits: (document, range, options) => edits(document, options, range),
		}),
	];
}

/** The `.editorconfig`'s settings, over the editor's tabs or spaces and the columns of the settings. */
function formatOptions(document: vscode.TextDocument, editor: vscode.FormattingOptions): FormatOptions {
	const settings = vscode.workspace.getConfiguration("tsasm.format", document);
	const column = (name: "opcodeColumn" | "operandColumn" | "commentColumn") => Math.max(0, Math.floor(settings.get<number>(name, DEFAULT_FORMAT[name])));
	const fromEditor: FormatOptions = {
		tabSize: Math.max(1, editor.tabSize),
		insertSpaces: editor.insertSpaces,
		opcodeColumn: column("opcodeColumn"),
		operandColumn: column("operandColumn"),
		commentColumn: column("commentColumn"),
		indentBlocks: settings.get<boolean>("indentBlocks", DEFAULT_FORMAT.indentBlocks),
	};
	// An untitled file has no folder to find an `.editorconfig` from.
	if (document.uri.scheme !== "file") return fromEditor;
	return { ...fromEditor, ...formatSettings(editorConfigFor(document.uri.fsPath, readFile)) };
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
	const document = await vscode.workspace.openTextDocument(error.file);
	const position = new vscode.Position(error.line - 1, 0);
	await vscode.window.showTextDocument(document, { selection: new vscode.Range(position, position) });
}
