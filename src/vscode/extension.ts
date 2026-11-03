/**
 * extension.ts
 *
 * * The VS Code extension's code (editors/vscode): the paths of `.include`, `.incbin` and `.define … from` open their file.
 * * The colours are its grammar's, built by grammar.ts.
 */

import * as vscode from "vscode";
import { findFileLinks } from "./links";

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.languages.registerDocumentLinkProvider({ language: "tsasm" }, { provideDocumentLinks }));
}

function provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
	// An untitled file has no directory its paths are relative to.
	if (document.isUntitled) return [];
	const directory = vscode.Uri.joinPath(document.uri, "..");
	return findFileLinks(document.getText()).map(({ start, end, path }) => {
		const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
		// As the assembler joins them: a path starting with "/" is still relative to the file.
		const link = new vscode.DocumentLink(range, vscode.Uri.joinPath(directory, path));
		link.tooltip = `Open ${path}`;
		return link;
	});
}
