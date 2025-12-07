import type { Token } from "./lexer/lexer.class";
import { getHex } from "./utils/hex.util";

// Internal unique key for the global namespace to avoid collisions with user namespaces
const INTERNAL_GLOBAL = "@@GLOBAL";

export type SymbolValue = number | string | object | Token[] | SymbolValue[];

interface PASymbol {
	name: string;
	value: SymbolValue;
	isGlobal: boolean;
	namespace: string;
}

export class PASymbolTable {
	private symbols: Map<string, Map<string, PASymbol>> = new Map();
	private scopeStack: string[] = [];
	private scopeCounter = 0;

	constructor() {
		this.scopeStack.push(INTERNAL_GLOBAL);
		this.symbols.set(INTERNAL_GLOBAL, new Map());
	}

	/** Pushes a new scope onto the stack, making it the current scope. */
	pushScope(name?: string): void {
		const newScopeName = name || `__LOCAL_${this.scopeCounter++}__`;
		this.scopeStack.push(newScopeName);
		if (!this.symbols.has(newScopeName)) this.symbols.set(newScopeName, new Map());
	}

	/** Pops the current scope from the stack, returning to the parent scope. */
	popScope(): void {
		if (this.scopeStack.length > 1) {
			const oldScopeName = this.scopeStack.pop();
			if (oldScopeName) this.symbols.delete(oldScopeName);
		}
	}

	/** Changes the current active namespace. */
	setNamespace(name: string): void {
		// Reset to INTERNAL_GLOBAL base, then optionally push a named namespace on top.
		this.scopeStack = [INTERNAL_GLOBAL];

		if (!this.symbols.has(INTERNAL_GLOBAL)) this.symbols.set(INTERNAL_GLOBAL, new Map());

		const nsRaw = name.toLowerCase() || "global";

		console.log(`Set namespace: ${nsRaw}`);

		if (nsRaw === "global") return;

		if (!this.symbols.has(nsRaw)) this.symbols.set(nsRaw, new Map());
		this.scopeStack.push(nsRaw);
	}

	/**
	 * Pushes a named namespace onto the stack without destroying existing namespaces.
	 * Named namespaces are persistent (their symbol maps are not deleted on pop).
	 */
	pushNamespace(name: string): void {
		if (name.toLowerCase() === "global") {
			this.setNamespace("global");
			return;
		}
		if (!this.symbols.has(name)) this.symbols.set(name, new Map());
		this.scopeStack.push(name);
		console.log(`Set namespace: ${name}`);
	}

	/**
	 * Pops the current namespace if it's not the GLOBAL namespace.
	 * Does not delete the namespace symbol map so named namespaces remain addressable.
	 */
	popNamespace(): void {
		// Don't pop GLOBAL. Also avoid popping ephemeral local/macro scopes via this call.
		const currentRaw = this.scopeStack[this.scopeStack.length - 1];
		if (currentRaw === INTERNAL_GLOBAL) return;
		if (typeof currentRaw === "string" && (currentRaw.startsWith("__LOCAL_") || currentRaw.startsWith("__MACRO_"))) {
			// It's a local/macro scope; do not pop it via namespace pop.
			return;
		}
		// Safe to pop named namespace (do not delete its symbol map so it remains addressable)
		this.scopeStack.pop();
		console.log(`Set namespace: ${this.getCurrentNamespace()}`);
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

	/**
	 * Adds a symbol (label or constant). Handles local labels starting with '.'
	 * @param name The symbol name.
	 * @param value The resolved address or value.
	 */
	addSymbol(symbolName: string, value: SymbolValue): void {
		const name = symbolName.toUpperCase();

		const namespaceKey = this.scopeStack[this.scopeStack.length - 1] as string;
		const namespace = this.getCurrentNamespace();

		// Local labels start with a dot (e.g., '.loop')
		const isLocal = name.startsWith(".");
		if (isLocal) {
			// Local labels are scoped to the current active global/named scope
			// For simplicity, we'll store them under the current namespace.
			// A more complex assembler would track the last global label for local scope.
		}

		const scope = this.symbols.get(namespaceKey);

		if (!scope) throw `ERROR: PASymbol ${namespace} doesn't exist.`;
		if (scope.has(name)) throw `ERROR: PASymbol ${namespace}::${name} redefined.`;

		scope.set(name, {
			name,
			value,
			isGlobal: !isLocal,
			namespace: namespaceKey,
		});
	}

	/**
	 * Defines or updates a symbol in the *current* scope.
	 * This is ideal for loop iterators or re-assignable variables.
	 * @param name The symbol name.
	 * @param value The value to assign.
	 * @param isGlobal In the context of a local scope, this is always false.
	 */
	define(symbolName: string, value: SymbolValue, isGlobal = false): void {
		const name = symbolName.toUpperCase();

		const scopeKey = this.scopeStack[this.scopeStack.length - 1] as string;
		const scope = this.symbols.get(scopeKey);
		if (!scope) throw new Error(`[SymbolTable] ERROR: Current scope '${this.getCurrentNamespace()}' does not exist.`);

		scope.set(name, { name, value, isGlobal, namespace: scopeKey });
	}

	updateSymbol(symbolName: string, value: SymbolValue): void {
		const name = symbolName.toUpperCase();

		// Search up the scope stack to find the symbol.
		for (let i = this.scopeStack.length - 1; i >= 0; i--) {
			const scopeName = this.scopeStack[i] as string;
			const scope = this.symbols.get(scopeName);
			const symbol = scope?.get(name);
			if (symbol) {
				symbol.value = value;
				return;
			}
		}

		// If we get here, the symbol was not found in any active scope.
		const currentScope = this.getCurrentNamespace();
		throw new Error(`[SymbolTable] Attempted to set value for undefined symbol '${name}' in scope '${currentScope}'.`);
	}

	// test is a symbol is defined in the current NS or a specific one
	isDefined(symbolName: string) {
		if (symbolName.includes("::")) {
			const [ns, symName] = symbolName.split("::") as [string, string];
			const targetScope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
			return targetScope?.has(symName);
		}
		const currentScope = this.getCurrentScope();
		return currentScope?.has(symbolName.toUpperCase());
	}

	/**
	 * Attempts to look up a symbol. Searches current namespace first, then the whole stack up to global.
	 */
	lookupSymbol(symbolName: string): SymbolValue | undefined {
		const name = symbolName.toUpperCase();

		// 1. Search from the current scope up to the global scope.
		for (let i = this.scopeStack.length - 1; i >= 0; i--) {
			const scopeName = this.scopeStack[i] as string;
			const scope = this.symbols.get(scopeName);
			if (scope?.has(name)) return scope.get(name)?.value;
		}

		// 2. Handle namespaced lookup (TOTO::LABEL)
		if (name.includes("::")) {
			const [ns, symName] = name.split("::") as [string, string];
			const targetScope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
			if (targetScope?.has(symName)) return targetScope.get(symName)?.value;
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

		const dict: Record<string, Record<string, SymbolValue>> = {};

		for (const [namespace, symbolDict] of this.symbols.entries()) {
			let nsDict = dict[namespace];
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
				nsDict[symbol.name] = value;
			}
			dict[namespace] = nsDict;
		}

		// const dict: Record<string, SymbolValue[]> = {};
		// for (const scope of this.symbols.values()) {
		// 	for (const symbol of scope.values()) {
		// 		if (symbol.name === "*") continue;
		// 		const key = getHex(symbol.value);
		// 		const currentEntry = dict[symbol.name];
		// 		let ns = symbol.namespace;
		// 		if (ns === INTERNAL_GLOBAL) ns = "global";
		// 		if (currentEntry) currentEntry.push(`${ns}::${symbol.value}`);
		// 		else dict[symbol.name] = [`${ns}::${symbol.value}`];
		// 	}
		// }
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
	let prevRow = new Array(aLen + 1);
	let currRow = new Array(aLen + 1);

	// Initialize first row
	for (let i = 0; i <= aLen; i++) {
		prevRow[i] = i;
	}

	// Calculate distances
	for (let j = 1; j <= bLen; j++) {
		currRow[0] = j;

		for (let i = 1; i <= aLen; i++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			currRow[i] = Math.min(
				currRow[i - 1] + 1, // deletion
				prevRow[i] + 1, // insertion
				prevRow[i - 1] + cost, // substitution
			);
		}

		// Swap rows (reuse arrays)
		[prevRow, currRow] = [currRow, prevRow];
	}

	return prevRow[aLen];
}
