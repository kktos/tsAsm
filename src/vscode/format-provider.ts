/**
 * format-provider.ts
 *
 * * Format Document and Format Selection, and so `editor.formatOnSave`: the source in columns, see `format.ts`. Tabs or
 *   spaces and their width are the editor's, as `.editorconfig` sets them with the EditorConfig extension; the columns
 *   are the `tsasm.format.*` settings.
 * * Which words are mnemonics and macros comes from the projects that read the file, when it was assembled.
 */

import * as vscode from "vscode";
import { DEFAULT_FORMAT, type FormatOptions, formatSource, statementTest } from "./format";
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
		const formatted = formatSource(text, formatOptions(document, editor), statementTest(text, lang, cpu, macros)).split("\n");
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

/** The editor's tabs or spaces, and the columns of the settings. */
function formatOptions(document: vscode.TextDocument, editor: vscode.FormattingOptions): FormatOptions {
	const settings = vscode.workspace.getConfiguration("tsasm.format", document);
	const column = (name: "opcodeColumn" | "operandColumn" | "commentColumn") => Math.max(0, Math.floor(settings.get<number>(name, DEFAULT_FORMAT[name])));
	return {
		tabSize: Math.max(1, editor.tabSize),
		insertSpaces: editor.insertSpaces,
		opcodeColumn: column("opcodeColumn"),
		operandColumn: column("operandColumn"),
		commentColumn: column("commentColumn"),
		indentBlocks: settings.get<boolean>("indentBlocks", DEFAULT_FORMAT.indentBlocks),
	};
}
