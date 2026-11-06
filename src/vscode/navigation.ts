/**
 * navigation.ts
 *
 * * Cmd+click on a name goes to its definition, its hover tells what it is, and Shift+F12 lists its references: from
 *   the projects' indexes.
 */

import * as vscode from "vscode";
import type { Place } from "./places";
import type { Projects } from "./projects";
import { distinctEntries, hoverText } from "./symbol-index";

const SELECTOR = { language: "tsasm" };

export function registerNavigation(projects: Projects): vscode.Disposable[] {
	return [
		vscode.languages.registerDefinitionProvider(SELECTOR, {
			provideDefinition(document, position) {
				const entries = distinctEntries(projects.entriesAt(document.uri, position));
				const targets = new Map(entries.map(({ place, target }) => [JSON.stringify(target), { place, target }]));
				return [...targets.values()].map(({ place, target }): vscode.LocationLink => ({
					originSelectionRange: range(place),
					targetUri: vscode.Uri.file(target.file),
					targetRange: range(target),
					targetSelectionRange: range(target),
				}));
			},
		}),
		vscode.languages.registerReferenceProvider(SELECTOR, {
			provideReferences(document, position, context) {
				return projects
					.referencesAt(document.uri, position, context.includeDeclaration)
					.map((place) => new vscode.Location(vscode.Uri.file(place.file), range(place)));
			},
		}),
		vscode.languages.registerHoverProvider(SELECTOR, {
			provideHover(document, position) {
				const entries = distinctEntries(projects.entriesAt(document.uri, position));
				const [first] = entries;
				if (!first) return undefined;
				const text = hoverText(entries, (file) => vscode.workspace.asRelativePath(file));
				return new vscode.Hover(new vscode.MarkdownString(text), range(first.place));
			},
		}),
	];
}

function range({ line, column, endColumn }: Place): vscode.Range {
	return new vscode.Range(line - 1, column - 1, line - 1, endColumn - 1);
}
