/**
 * extension.ts
 *
 * * The VS Code extension's code (editors/vscode): the paths of `.include`, `.incbin` and `.define … from` open their file,
 *   the projects' errors and warnings are in the Problems panel (projects.ts), and a name goes to its definition, its
 *   hover telling what it is (navigation.ts), the listing opens beside a file (listing-view.ts), and a file is laid out
 *   in columns (format-provider.ts).
 * * The colours are its grammar's, built by grammar.ts.
 */

import * as vscode from "vscode";
import { registerFormatting } from "./format-provider";
import { findFileLinks } from "./links";
import { registerListing } from "./listing-view";
import { registerNavigation } from "./navigation";
import { Projects } from "./projects";

export function activate(context: vscode.ExtensionContext) {
	const projects = new Projects();
	context.subscriptions.push(
		vscode.languages.registerDocumentLinkProvider({ language: "tsasm" }, { provideDocumentLinks }),
		projects,
		...registerNavigation(projects),
		...registerListing(projects),
		...registerFormatting(projects),
	);
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
