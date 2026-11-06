/**
 * navigation.ts
 *
 * * Cmd+click on a name goes to its definition, its hover tells what it is, and Shift+F12 lists its references: from
 *   the projects' indexes.
 * * The outline (Cmd+Shift+O) and the breadcrumbs: a file's blocks from its text, its symbols from the indexes; the
 *   workspace's symbols (Cmd+T).
 */

import * as vscode from "vscode";
import { scanBlocks } from "./blocks";
import { buildOutline, type OutlineKind, type OutlineNode, type Range, workspaceSymbols } from "./outline";
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
		vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
			provideDocumentSymbols(document) {
				return buildOutline(scanBlocks(document.getText()), projects.definitionsIn(document.uri)).map(documentSymbol);
			},
		}),
		vscode.languages.registerWorkspaceSymbolProvider({
			provideWorkspaceSymbols(query) {
				const { definitions, namespaces } = projects.workspaceDefinitions();
				return workspaceSymbols(definitions, namespaces, query).map(
					({ name, kind, container, place }) =>
						new vscode.SymbolInformation(name, SYMBOL_KINDS[kind], container ?? "", new vscode.Location(vscode.Uri.file(place.file), range(place))),
				);
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

const SYMBOL_KINDS: Record<OutlineKind, vscode.SymbolKind> = {
	macro: vscode.SymbolKind.Module,
	proc: vscode.SymbolKind.Function,
	function: vscode.SymbolKind.Method,
	namespace: vscode.SymbolKind.Namespace,
	segment: vscode.SymbolKind.Package,
	label: vscode.SymbolKind.Field,
	constant: vscode.SymbolKind.Constant,
	variable: vscode.SymbolKind.Variable,
};

function documentSymbol(node: OutlineNode): vscode.DocumentSymbol {
	const symbol = new vscode.DocumentSymbol(node.name, node.detail, SYMBOL_KINDS[node.kind], outlineRange(node.range), outlineRange(node.selection));
	symbol.children = node.children.map(documentSymbol);
	return symbol;
}

function outlineRange({ start, end }: Range): vscode.Range {
	return new vscode.Range(start.line - 1, start.column - 1, end.line - 1, end.column - 1);
}

function range({ line, column, endColumn }: Place): vscode.Range {
	return new vscode.Range(line - 1, column - 1, line - 1, endColumn - 1);
}
