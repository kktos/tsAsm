/**
 * navigation.ts
 *
 * * Cmd+click on a name goes to its definition, its hover tells what it is, and Shift+F12 lists its references: from
 *   the projects' indexes.
 * * F2 renames a symbol: see `rename.ts`.
 * * Completion and signature help: see `completion.ts`.
 * * Folding by blocks, routines and comments: see `folding.ts`.
 * * The outline (Cmd+Shift+O) and the breadcrumbs: a file's blocks from its text, its symbols from the indexes; the
 *   workspace's symbols (Cmd+T).
 */

import * as vscode from "vscode";
import { scanBlocks } from "./blocks";
import { type Completion, type CompletionKind, complete, type SourceContext, signatureAt } from "./completion";
import { foldingRanges } from "./folding";
import { type Language, language } from "./language";
import { buildOutline, type OutlineKind, type OutlineNode, type Range, workspaceSymbols } from "./outline";
import type { Place } from "./places";
import type { Projects } from "./projects";
import { distinctEntries, hoverText } from "./symbol-index";

const SELECTOR = { language: "tsasm" };

export function registerNavigation(projects: Projects): vscode.Disposable[] {
	// The language, from the assembler's code: built once, when first asked for.
	let lang: Language | undefined;
	const sourceContext = (document: vscode.TextDocument, position: vscode.Position): SourceContext => {
		lang ??= language();
		return {
			text: document.getText(),
			line: position.line + 1,
			column: position.character + 1,
			language: lang,
			file: document.uri.fsPath,
			...projects.sourceContext(document.uri),
		};
	};
	return [
		vscode.languages.registerCompletionItemProvider(
			SELECTOR,
			{
				provideCompletionItems(document, position) {
					return complete(sourceContext(document, position)).map((item) => completionItem(item, position.line));
				},
			},
			".",
			":",
		),
		vscode.languages.registerSignatureHelpProvider(
			SELECTOR,
			{
				provideSignatureHelp(document, position) {
					const signature = signatureAt(sourceContext(document, position));
					if (!signature) return undefined;
					const information = new vscode.SignatureInformation(signature.label, signature.documentation);
					information.parameters = signature.parameters.map((offsets) => new vscode.ParameterInformation(offsets));
					const help = new vscode.SignatureHelp();
					help.signatures = [information];
					help.activeSignature = 0;
					help.activeParameter = signature.active;
					return help;
				},
			},
			{ triggerCharacters: ["(", ",", " "], retriggerCharacters: [","] },
		),
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
		vscode.languages.registerFoldingRangeProvider(SELECTOR, {
			// The labels' folds come from the assemblies.
			onDidChangeFoldingRanges: projects.onDidAssemble,
			provideFoldingRanges(document) {
				const labels = projects
					.definitionsIn(document.uri)
					.filter(({ symbol }) => symbol.kind === "label" && !symbol.name.includes("."))
					.map(({ target }) => target.line);
				return foldingRanges(document.getText(), scanBlocks(document.getText()), labels).map(
					({ start, end, kind }) => new vscode.FoldingRange(start - 1, end - 1, kind ? FOLDING_KINDS[kind] : undefined),
				);
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
		vscode.languages.registerRenameProvider(SELECTOR, {
			async prepareRename(document, position) {
				const { place, placeholder } = await projects.prepareRename(document.uri, position);
				return { range: range(place), placeholder };
			},
			async provideRenameEdits(document, position, newName) {
				const edit = new vscode.WorkspaceEdit();
				for (const { place, text, unread } of await projects.renameEdits(document.uri, position, newName)) {
					const metadata = unread ? { needsConfirmation: true, label: UNREAD, description: UNREAD_WHY } : undefined;
					edit.replace(vscode.Uri.file(place.file), range(place), text, metadata);
				}
				return edit;
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

const UNREAD = "Not read by the assembly";
const UNREAD_WHY = "The name, where the last assembly didn't read it: an .if branch not taken, a macro not called, .def().";

const COMPLETION_KINDS: Record<CompletionKind, vscode.CompletionItemKind> = {
	mnemonic: vscode.CompletionItemKind.Keyword,
	directive: vscode.CompletionItemKind.Keyword,
	macro: vscode.CompletionItemKind.Module,
	label: vscode.CompletionItemKind.Field,
	constant: vscode.CompletionItemKind.Constant,
	variable: vscode.CompletionItemKind.Variable,
	function: vscode.CompletionItemKind.Method,
	"system function": vscode.CompletionItemKind.Function,
	"system variable": vscode.CompletionItemKind.Property,
	namespace: vscode.CompletionItemKind.Module,
	option: vscode.CompletionItemKind.Property,
	cpu: vscode.CompletionItemKind.EnumMember,
};

function completionItem(completion: Completion, line: number): vscode.CompletionItem {
	const item = new vscode.CompletionItem(completion.label, COMPLETION_KINDS[completion.kind]);
	item.insertText = completion.snippet ? new vscode.SnippetString(completion.insert) : completion.insert;
	item.range = new vscode.Range(line, completion.start - 1, line, completion.end - 1);
	if (completion.detail) item.detail = completion.detail;
	if (completion.documentation) item.documentation = new vscode.MarkdownString(completion.documentation);
	if (completion.parameterHints) item.command = { command: "editor.action.triggerParameterHints", title: "Parameter hints" };
	return item;
}

const FOLDING_KINDS = { comment: vscode.FoldingRangeKind.Comment, region: vscode.FoldingRangeKind.Region };

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
