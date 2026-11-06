/**
 * listing-view.ts
 *
 * * The command "tsAsm: Show Listing": the listing of the file's project, read-only, beside the source, at the cursor's
 *   line, highlighted. While it's shown, it follows the cursor in the project's files, and the assemblies.
 * * The listing is the CLI's with `passes.pass2`, from the last good assembly: see `listing.ts`. Nothing is written.
 */

import * as vscode from "vscode";
import { listingLineOf, listingText } from "./listing";
import type { Projects } from "./projects";

export const SHOW_LISTING = "tsasm.showListing";
const SCHEME = "tsasm-listing";

export function registerListing(projects: Projects): vscode.Disposable[] {
	const changed = new vscode.EventEmitter<vscode.Uri>();
	const highlight = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
	});
	// A listing's URI: its path the listing's, as the CLI names it, so is its tab; its query the project file's path.
	const uriOf = ({ project, path }: { project: string; path: string }) => vscode.Uri.file(path).with({ scheme: SCHEME, query: project });
	const listingEditors = () => vscode.window.visibleTextEditors.filter(({ document }) => document.uri.scheme === SCHEME);

	/** Shows in `listing` the lines of the cursor's line in `source`: highlighted, or, for a line that listed nothing, the closest above's. */
	const reveal = (source: vscode.TextEditor, listing: vscode.TextEditor) => {
		const lines = projects.listingOf(listing.document.uri.query) ?? [];
		const at = listingLineOf(lines, source.document.uri.fsPath, source.selection.active.line + 1);
		if (!at || at.index >= listing.document.lineCount) {
			listing.setDecorations(highlight, []);
			return;
		}
		const range = new vscode.Range(at.index, 0, at.index, 0);
		listing.setDecorations(highlight, at.exact ? [range] : []);
		listing.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	};

	/** Follows the cursor of `source` in the listings shown of its projects. */
	const follow = (source: vscode.TextEditor | undefined) => {
		if (source?.document.languageId !== "tsasm") return;
		const mine = new Set(projects.listingsOf(source.document.uri).map(({ project }) => project));
		for (const listing of listingEditors()) if (mine.has(listing.document.uri.query)) reveal(source, listing);
	};

	return [
		changed,
		highlight,
		vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
			onDidChange: changed.event,
			provideTextDocumentContent: (uri) => listingText(projects.listingOf(uri.query) ?? []),
		}),
		vscode.commands.registerCommand(SHOW_LISTING, async () => {
			const source = vscode.window.activeTextEditor;
			if (source?.document.languageId !== "tsasm") return;
			const listings = projects.listingsOf(source.document.uri);
			let [chosen] = listings;
			if (!chosen) {
				void vscode.window.showInformationMessage("No listing for this file: it's in no project, or its project hasn't assembled yet.");
				return;
			}
			if (listings.length > 1) {
				const items = listings.map((listing) => ({ label: vscode.workspace.asRelativePath(listing.project), listing }));
				const picked = await vscode.window.showQuickPick(items, { placeHolder: "The project whose listing to show" });
				if (!picked) return;
				chosen = picked.listing;
			}
			const document = await vscode.workspace.openTextDocument(uriOf(chosen));
			const listing = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true });
			reveal(source, listing);
		}),
		vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => follow(textEditor)),
		vscode.window.onDidChangeActiveTextEditor(follow),
		// A new assembly: the listings open are read again, then follow the cursor.
		projects.onDidAssemble(() => {
			for (const { uri } of vscode.workspace.textDocuments) if (uri.scheme === SCHEME) changed.fire(uri);
		}),
		vscode.workspace.onDidChangeTextDocument(({ document }) => document.uri.scheme === SCHEME && follow(vscode.window.activeTextEditor)),
	];
}
