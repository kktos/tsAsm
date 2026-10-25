import type { ILister } from "../helpers/lister.class";
import type { Token } from "../shared/lexer/lexer.class";
import { AsmError, type IncludeStack } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";

// Internal unique key for the global namespace to avoid collisions with user namespaces
const INTERNAL_GLOBAL = "%%GLOBAL";

export type SymbolValue = number | string | object | Token[] | SymbolValue[];

type SymbolSource = {
	filename: string;
	line: number | string;
	column: number;
};
interface PASymbol {
	name: string;
	value: SymbolValue;
	isConstant: boolean;
	namespace: string;
	source: string;
	line: number | string;
	column: number;
	/** The `.include` directives its file was reached through. */
	includeStack: IncludeStack;
	/** The pass that last defined it, 0 outside the passes: see `isDefined`. */
	definedInPass: number;
}

/** An error about a symbol already defined, with a note pointing at its definition. */
function definitionError(message: string, symbol: PASymbol, note: string): AsmError {
	const error = new AsmError(message);
	error.notes.push({
		message: note,
		location: { file: symbol.source, line: symbol.line, column: symbol.column },
		includeStack: symbol.includeStack,
	});
	return error;
}

export class PASymbolTable {
	private symbols: Map<string, Map<string, PASymbol>> = new Map();
	private scopeStack: string[] = [];
	private scopeCounter = 0;
	private savedSymbols: Map<string, Map<string, PASymbol>> = new Map();
	private namespaceMetadata: Map<string, Record<string, SymbolValue>> = new Map();
	/** What messages call the scopes the user can't name (a macro call's, a function's): `macro m`, `function f`. */
	private scopeLabels: Map<string, string> = new Map();
	/** The pass being assembled, kept with each symbol defined. 0 outside the passes (symbols set up before assembling, the linker). */
	public pass = 0;

	constructor(
		private readonly lister: ILister,
		/** The `.include` directives the file being assembled was reached through: kept with each symbol defined. */
		private readonly includeStack: () => IncludeStack = () => [],
	) {
		this.reset();
	}

	/** Forgets every symbol, namespace and scope: back to an empty global scope. */
	reset(): void {
		this.symbols = new Map([[INTERNAL_GLOBAL, new Map()]]);
		this.scopeStack = [INTERNAL_GLOBAL];
		this.scopeCounter = 0;
		this.savedSymbols = new Map();
		this.namespaceMetadata = new Map();
		this.scopeLabels = new Map();
	}

	/** Pushes a new scope onto the stack, making it the current scope. */
	pushScope(name?: string) {
		const newScopeName = name || `@@LOCAL_${this.scopeCounter++}__`;
		this.scopeStack.push(newScopeName);
		if (!this.symbols.has(newScopeName)) this.symbols.set(newScopeName, new Map());
	}

	/** `label` is what messages call the scope, when the user can't name it: `macro m`, `function f`. */
	restoreAndPushScope(name: string, label?: string) {
		let scope = this.savedSymbols.get(name);
		if (!scope) scope = new Map();
		this.scopeStack.push(name);
		if (!this.symbols.has(name)) this.symbols.set(name, scope);
		if (label) this.scopeLabels.set(name, label);
	}

	/** `Symbol 'X' redefined.`, with a note at its first definition. */
	redefinitionError(symbol: PASymbol): AsmError {
		const { name, scope } = this.messageName(symbol);
		return definitionError(`Symbol '${name}' redefined${scope}.`, symbol, "first defined here");
	}

	/** `Can't redefine constant 'X'.`, with a note at its definition. */
	private constantRedefinitionError(symbol: PASymbol): AsmError {
		const { name, scope } = this.messageName(symbol);
		return definitionError(`Can't redefine constant '${name}'${scope}.`, symbol, "defined here");
	}

	/**
	 * A symbol's name for messages: in its namespace, unless it's the global one, or the scope it's in when the user
	 * can't name it (`'X'` and ` in macro m`).
	 */
	private messageName(symbol: PASymbol): { name: string; scope: string } {
		const label = this.scopeLabels.get(symbol.namespace);
		if (label) return { name: symbol.name, scope: ` in ${label}` };
		return { name: symbol.namespace === INTERNAL_GLOBAL ? symbol.name : `${symbol.namespace}::${symbol.name}`, scope: "" };
	}

	/**
	 * Stashes a symbol of the current scope, like `git stash`, so the name can be defined again for a while
	 * (a loop's iterator): the returned function pops it back, leaving the scope as it was.
	 */
	stashSymbol(symbolName: string): () => void {
		const scope = this.getCurrentScope() as Map<string, PASymbol>;
		const name = symbolName.toUpperCase();
		const saved = scope.get(name);
		scope.delete(name);
		return () => {
			if (saved) scope.set(name, saved);
			else scope.delete(name);
		};
	}

	/** Pops the current scope from the stack, returning to the parent scope. */
	popScope(parm?: { wannaSave: boolean }) {
		if (this.scopeStack.length > 1) {
			const oldScopeName = this.scopeStack.pop();
			if (oldScopeName) {
				if (parm?.wannaSave) this.savedSymbols.set(oldScopeName, this.symbols.get(oldScopeName) as Map<string, PASymbol>);
				this.symbols.delete(oldScopeName);
			}
		}
	}

	/** Changes the current active namespace. */
	setNamespace(name: string, metadata?: Record<string, SymbolValue>): void {
		// Reset to INTERNAL_GLOBAL base, then optionally push a named namespace on top.
		this.scopeStack = [INTERNAL_GLOBAL];

		if (!this.symbols.has(INTERNAL_GLOBAL)) this.symbols.set(INTERNAL_GLOBAL, new Map());

		if (!name || name.toLowerCase() === "global") {
			this.lister.directive("Set namespace: global");
			if (metadata) this.addNamespaceMetadata(INTERNAL_GLOBAL, metadata);
			return;
		}

		// Named namespaces are keyed in upper case, as lookups of `ns::symbol` are.
		const ns = name.toUpperCase();
		this.lister.directive(`Set namespace: ${ns}`);
		if (metadata) this.addNamespaceMetadata(ns, metadata);

		if (!this.symbols.has(ns)) this.symbols.set(ns, new Map());
		this.scopeStack.push(ns);
	}

	/**
	 * Pushes a named namespace onto the stack without destroying existing namespaces.
	 * Named namespaces are persistent (their symbol maps are not deleted on pop).
	 */
	pushNamespace(name: string, metadata?: Record<string, SymbolValue>): void {
		if (name.toLowerCase() === "global") {
			this.setNamespace("global", metadata);
			return;
		}
		// Same key as setNamespace and the lookups: upper case.
		const ns = name.toUpperCase();
		if (!this.symbols.has(ns)) this.symbols.set(ns, new Map());
		this.scopeStack.push(ns);

		if (metadata) {
			this.addNamespaceMetadata(ns, metadata);
		}

		this.lister.directive(`Set namespace: ${ns}`);
	}

	/**
	 * Pops the current namespace if it's not the GLOBAL namespace.
	 * Does not delete the namespace symbol map so named namespaces remain addressable.
	 */
	popNamespace(): void {
		// Don't pop GLOBAL. Also avoid popping ephemeral local/macro scopes via this call.
		const currentRaw = this.scopeStack[this.scopeStack.length - 1];
		if (currentRaw === INTERNAL_GLOBAL) return;
		// It's a local scope; do not pop it via namespace pop.
		if (currentRaw?.startsWith("@@")) return;

		// Safe to pop named namespace (do not delete its symbol map so it remains addressable)
		this.scopeStack.pop();

		this.lister.directive(`Set namespace: ${this.getCurrentNamespace()}`);
	}

	private addNamespaceMetadata(name: string, metadata: Record<string, SymbolValue>) {
		const existing = this.namespaceMetadata.get(name) || {};
		this.namespaceMetadata.set(name, { ...existing, ...metadata });
	}

	public getNamespaceMetadata(name: string) {
		const ns = name.toLowerCase() === "global" ? INTERNAL_GLOBAL : name.toUpperCase();
		return this.namespaceMetadata.get(ns);
	}

	/** Retrieves the current active namespace. */
	getCurrentNamespace(): string {
		const current = this.scopeStack[this.scopeStack.length - 1] as string;
		if (current === INTERNAL_GLOBAL) return "global";
		return current;
	}

	getCurrentScope() {
		const current = this.scopeStack[this.scopeStack.length - 1] as string;
		return this.symbols.get(current);
	}

	isVolatileScope() {
		const current = this.scopeStack[this.scopeStack.length - 1] as string;
		return current.startsWith("@@");
	}

	findSymbol(symbolName: string) {
		const name = symbolName.toUpperCase();

		// Handle namespaced lookup (TOTO::LABEL)
		if (name.includes("::")) {
			const [ns, symName] = name.split("::") as [string, string];
			const targetScope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
			if (targetScope?.has(symName)) return { scope: targetScope, symbol: targetScope.get(symName) as PASymbol };
		}

		// Search from the local scopes up to the current scope.
		for (let i = this.scopeStack.length - 1; i >= 0; i--) {
			const scopeName = this.scopeStack[i] as string;
			const scope = this.symbols.get(scopeName);
			if (scope?.has(name)) return { scope: scope, symbol: scope.get(name) as PASymbol };
			if (!scopeName.startsWith("@@")) break;
		}

		return undefined;
	}

	defineConstant(constantName: string, value: SymbolValue, source: SymbolSource) {
		let scope: Map<string, PASymbol> | undefined;
		let name = "";
		let ns = "";

		if (constantName.includes("::")) {
			[ns, name] = constantName.split("::") as [string, string];
			scope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
		} else {
			ns = this.scopeStack[this.scopeStack.length - 1] as string;
			scope = this.symbols.get(ns);
			name = constantName;
		}

		if (!scope) throw new Error(`defineConstant: PASymbol Namespace "${ns}" doesn't exist.`);

		name = name.toUpperCase();
		const existing = scope.get(name);
		if (existing) throw this.redefinitionError(existing);

		scope.set(name, {
			name,
			value,
			isConstant: true,
			namespace: ns,
			source: source.filename,
			line: source.line,
			column: source.column,
			includeStack: this.includeStack(),
			definedInPass: this.pass,
		});
	}

	defineVariable(variableName: string, value: SymbolValue, source: SymbolSource, nonVolatile = false) {
		let ns = "";

		if (nonVolatile) {
			// Find the first non-volatile scope (bottom-up search)
			for (let i = this.scopeStack.length - 1; i >= 0; i--) {
				const key = this.scopeStack[i] as string;
				const isVolatile = key.startsWith("@@") && !key.startsWith("@@function");
				if (!isVolatile) {
					ns = key;
					break;
				}
			}
		}
		if (!ns) ns = this.scopeStack[this.scopeStack.length - 1] as string;

		const scope = this.symbols.get(ns);
		if (!scope) throw new Error(`PASymbol ${ns} doesn't exist.`);

		const name = variableName.toUpperCase();

		const symbol = scope.get(name);
		if (symbol?.isConstant) throw this.constantRedefinitionError(symbol);

		scope.set(name, {
			name,
			value,
			isConstant: false,
			namespace: ns,
			source: source.filename,
			line: source.line,
			column: source.column,
			includeStack: this.includeStack(),
			definedInPass: this.pass,
		});
	}

	assignVariable(variableName: string, value: SymbolValue) {
		const symbolData = this.findSymbol(variableName);

		let scope: Map<string, PASymbol> | undefined;
		let name = "";
		let symbol: PASymbol | undefined;
		let ns = "";

		if (symbolData) {
			scope = symbolData.scope;
			name = symbolData.symbol.name;
			symbol = symbolData.symbol;
			ns = symbol.namespace;
		} else {
			ns = this.scopeStack[this.scopeStack.length - 1] as string;

			scope = this.symbols.get(ns);
			if (!scope) throw new Error(`PASymbol ${this.getCurrentNamespace()} doesn't exist.`);
			name = variableName.toUpperCase();
			symbol = scope.get(name);
		}

		if (symbol?.isConstant) throw this.constantRedefinitionError(symbol);

		if (!symbol) throw new Error(`assignVariable: Unknown symbol "${ns === INTERNAL_GLOBAL ? "global" : ns}::${name}".`);

		scope.set(name, { ...symbol, value, definedInPass: this.pass });

		// scope.set(name, {
		// 	name,
		// 	value,
		// 	isConstant: false,
		// 	namespace: namespaceKey,
		// });
	}

	updateSymbol(symbolName: string, value: SymbolValue, nonVolatile = false) {
		let scope: Map<string, PASymbol> | undefined;
		let name = "";
		let ns = "";

		if (symbolName.includes("::")) {
			[ns, name] = symbolName.split("::") as [string, string];
			scope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
		} else {
			if (nonVolatile) {
				// Find the first non-volatile scope (bottom-up search)
				for (let i = this.scopeStack.length - 1; i >= 0; i--) {
					const key = this.scopeStack[i] as string;
					// const isVolatile = key.startsWith("@@") && !key.startsWith("@@function") && !key.startsWith("@@macro");
					const isVolatile = key.startsWith("@@") && !key.startsWith("@@function");
					if (!isVolatile) {
						ns = key;
						break;
					}
				}
			}
			if (!ns) ns = this.scopeStack[this.scopeStack.length - 1] as string;

			scope = this.symbols.get(ns);
			name = symbolName;
		}

		if (!scope) throw new Error(`updateSymbol: PASymbol Namespace "${ns}" doesn't exist.`);

		name = name.toUpperCase();
		const symbol = scope.get(name);
		if (!symbol) throw new Error(`Unknown symbol "${ns === INTERNAL_GLOBAL ? "global" : ns}::${name}".`);

		scope.set(name, { ...symbol, value, definedInPass: this.pass });
	}

	lookupSymbolInScope(symbolName: string) {
		let scope: Map<string, PASymbol> | undefined;

		let name = symbolName.toUpperCase();
		let ns = "";

		if (name.includes("::")) {
			[ns, name] = name.split("::") as [string, string];
			scope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
		} else {
			ns = this.getCurrentNamespace();
			const namespaceKey = this.scopeStack[this.scopeStack.length - 1] as string;
			scope = this.symbols.get(namespaceKey);
		}

		if (!scope) throw new Error(`PASymbol ${ns} doesn't exist.`);

		return scope.get(name);
	}

	// test is a symbol is defined in the current NS or a specific one
	hasSymbolInScope(symbolName: string) {
		// Upper case the whole name, namespace included, as lookupSymbol does.
		const name = symbolName.toUpperCase();
		if (name.includes("::")) {
			const [ns, symName] = name.split("::") as [string, string];
			const targetScope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
			return targetScope?.has(symName);
		}
		const currentScope = this.getCurrentScope();
		return currentScope?.has(name);
	}

	lookupSymbol(symbolName: string) {
		return this.lookup(symbolName)?.value;
	}

	/**
	 * Whether the symbol is defined at this point of the source: pass 2 still has every symbol of pass 1,
	 * so one defined further down isn't, as in pass 1. Both passes take the same `.if .undef(X)` branch.
	 */
	isDefined(symbolName: string): boolean {
		const symbol = this.lookup(symbolName);
		return symbol !== undefined && (symbol.definedInPass === 0 || symbol.definedInPass === this.pass);
	}

	private lookup(symbolName: string): PASymbol | undefined {
		const name = symbolName.toUpperCase();

		// Handle namespaced lookup (TOTO::LABEL)
		if (name.includes("::")) {
			const [ns, symName] = name.split("::") as [string, string];
			const targetScope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
			if (targetScope?.has(symName)) return targetScope.get(symName);
		}

		// Search from the local scopes up to the current scope.
		for (let i = this.scopeStack.length - 1; i >= 0; i--) {
			const scopeName = this.scopeStack[i] as string;
			const scope = this.symbols.get(scopeName);
			if (scope?.has(name)) return scope.get(name);
			// if (!scopeName.startsWith("@@")) break;
		}

		return undefined;
	}

	/**
	 * Gets the full path of a symbol, like "namespace::symbol".
	 * It searches for the symbol in the current scope hierarchy.
	 * @param symbolName The name of the symbol to find.
	 * @returns The full path of the symbol as a string.
	 */
	public getSymbolFullPath(symbolName: string): string {
		const name = symbolName.toUpperCase();

		// Search from the current scope up to the global scope.
		for (let i = this.scopeStack.length - 1; i >= 0; i--) {
			const scopeName = this.scopeStack[i] as string;
			const scope = this.symbols.get(scopeName);
			if (scope?.has(name)) {
				// Found the symbol. The namespace is part of the symbol definition.
				const symbol = scope.get(name);
				if (symbol) {
					const namespace = symbol.namespace === INTERNAL_GLOBAL ? "global" : symbol.namespace;

					// It's an ephemeral/local symbol, just return its name.
					if (namespace.startsWith("__")) return symbol.name;

					return `${namespace}::${symbol.name}`;
				}
			}
		}
		return "";
	}

	/**
	 * Gathers all unique symbol names from all scopes.
	 * @returns An array of all defined symbol names.
	 */
	public getAllSymbolNames(): string[] {
		const allNames = new Set<string>();
		for (const scope of this.symbols.values()) {
			scope.forEach((_symbol, name) => {
				allNames.add(name);
			});
		}
		return Array.from(allNames);
	}

	/** Finds symbols with a small Levenshtein distance to the given name. */
	public findSimilarSymbols(name: string, maxDistance = 2): string[] {
		const allSymbols = this.getAllSymbolNames();
		const suggestions: { name: string; distance: number }[] = [];

		for (const symbolName of allSymbols) {
			const distance = levenshteinDistance(name, symbolName);
			if (distance <= maxDistance) suggestions.push({ name: symbolName, distance });
		}

		// Sort by distance to show the closest match first
		suggestions.sort((a, b) => a.distance - b.distance);

		return suggestions.map((s) => s.name);
	}

	public getDict() {
		//return this.symbols;

		const dict: Record<string, Record<string | symbol, SymbolValue>> = {};

		for (const [namespace, symbolDict] of this.symbols.entries()) {
			let displayName = namespace;
			const metadata = this.namespaceMetadata.get(namespace);
			if (metadata) {
				const metaStr = Object.entries(metadata)
					.map(([k, v]) => `${k}=${v}`)
					.join(", ");
				if (metaStr) displayName = `${namespace} [${metaStr}]`;
			}

			let nsDict = dict[displayName];
			if (!nsDict) nsDict = {};
			for (const symbol of symbolDict.values()) {
				if (symbol.name === "*") continue;
				let value = "";
				switch (typeof symbol.value) {
					case "number":
						value = `number = $${getHex(symbol.value)}`;
						break;
					case "string":
						value = `string = "${symbol.value}"`;
						break;
					case "object":
						if (Array.isArray(symbol.value)) value = `array = ${JSON.stringify(symbol.value)}`;
						else value = `object = ${JSON.stringify(symbol.value)}`;
						break;
					case "undefined":
						value = "undefined";
						break;
				}
				nsDict[symbol.name] = `${value} ;${symbol.source}:${symbol.line}:${symbol.column}`;
			}
			dict[displayName] = nsDict;
		}

		return dict;
	}
}

/** Calculates the Levenshtein distance between two strings (optimized). */
function levenshteinDistance(name: string, symbolName: string): number {
	// Early exits for common cases
	if (name === symbolName) return 0;
	if (name.length === 0) return symbolName.length;
	if (symbolName.length === 0) return name.length;

	let a: string;
	let b: string;

	// Ensure 'name' is the shorter string (optimize space)
	if (name.length > symbolName.length) {
		[a, b] = [symbolName, name];
	} else {
		[a, b] = [name, symbolName];
	}

	const aLen = a.length;
	const bLen = b.length;

	// Use two rows instead of full matrix
	// First row is initialized to 0..aLen
	let prevRow = Array.from({ length: aLen + 1 }, (_, i) => i);
	let currRow = Array.from({ length: aLen + 1 }, () => 0);

	// Calculate distances
	for (let j = 1; j <= bLen; j++) {
		currRow[0] = j;

		for (let i = 1; i <= aLen; i++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			currRow[i] = Math.min(
				currRow[i - 1]! + 1, // deletion
				prevRow[i]! + 1, // insertion
				prevRow[i - 1]! + cost, // substitution
			);
		}

		// Swap rows (reuse arrays)
		[prevRow, currRow] = [currRow, prevRow];
	}

	return prevRow[aLen]!;
}
