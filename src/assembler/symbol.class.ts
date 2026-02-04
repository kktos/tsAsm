import type { ILister } from "../helpers/lister.class";
import type { Token } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";

// Internal unique key for the global namespace to avoid collisions with user namespaces
const INTERNAL_GLOBAL = "%%GLOBAL";

export type SymbolValue = number | string | object | Token[] | SymbolValue[];

interface PASymbol {
	name: string;
	value: SymbolValue;
	isConstant: boolean | undefined;
	namespace: string;
}

export class PASymbolTable {
	private symbols: Map<string, Map<string, PASymbol>> = new Map();
	private scopeStack: string[] = [];
	private scopeCounter = 0;
	private savedSymbols: Map<string, Map<string, PASymbol>> = new Map();
	private namespaceMetadata: Map<string, Record<string, SymbolValue>> = new Map();

	constructor(private readonly lister: ILister) {
		this.scopeStack.push(INTERNAL_GLOBAL);
		this.symbols.set(INTERNAL_GLOBAL, new Map());
	}

	/** Pushes a new scope onto the stack, making it the current scope. */
	pushScope(name?: string) {
		const newScopeName = name || `@@LOCAL_${this.scopeCounter++}__`;
		this.scopeStack.push(newScopeName);
		if (!this.symbols.has(newScopeName)) this.symbols.set(newScopeName, new Map());
	}

	restoreAndPushScope(name: string) {
		let scope = this.savedSymbols.get(name);
		if (!scope) scope = new Map();
		this.scopeStack.push(name);
		if (!this.symbols.has(name)) this.symbols.set(name, scope);
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

		const nsRaw = name.toLowerCase() || "global";

		this.lister.directive(`Set namespace: ${nsRaw}`);

		if (metadata) {
			this.addNamespaceMetadata(nsRaw === "global" ? INTERNAL_GLOBAL : nsRaw, metadata);
		}

		if (nsRaw === "global") return;

		if (!this.symbols.has(nsRaw)) this.symbols.set(nsRaw, new Map());
		this.scopeStack.push(nsRaw);
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
		if (!this.symbols.has(name)) this.symbols.set(name, new Map());
		this.scopeStack.push(name);

		if (metadata) {
			this.addNamespaceMetadata(name, metadata);
		}

		this.lister.directive(`Set namespace: ${name}`);
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
		const ns = name.toLowerCase() === "global" ? INTERNAL_GLOBAL : name;
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

	defineConstant(constantName: string, value: SymbolValue) {
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

		if (!scope) throw `PASymbol Namespace "${ns}" doesn't exist.`;

		name = name.toUpperCase();
		if (scope.has(name)) throw `PASymbol ${ns === INTERNAL_GLOBAL ? "global" : ns}::${name} redefined.`;

		scope.set(name, {
			name,
			value,
			isConstant: true,
			namespace: ns,
		});
	}

	defineVariable(variableName: string, value: SymbolValue) {
		const namespaceKey = this.scopeStack[this.scopeStack.length - 1] as string;
		const scope = this.symbols.get(namespaceKey);
		if (!scope) throw `PASymbol ${this.getCurrentNamespace()} doesn't exist.`;

		const name = variableName.toUpperCase();

		const symbol = scope.get(name);
		if (symbol?.isConstant) throw `Can't redefine constant symbol ${this.getCurrentNamespace()}::${variableName}.`;

		scope.set(name, {
			name,
			value,
			isConstant: false,
			namespace: namespaceKey,
		});
	}

	assignVariable(variableName: string, value: SymbolValue) {
		const symbolData = this.findSymbol(variableName);

		let scope: Map<string, PASymbol> | undefined;
		let name = "";
		let symbol: PASymbol | undefined;
		let namespaceKey = "";

		if (symbolData) {
			scope = symbolData.scope;
			name = symbolData.symbol.name;
			symbol = symbolData.symbol;
			namespaceKey = symbol.namespace;
		} else {
			namespaceKey = this.scopeStack[this.scopeStack.length - 1] as string;
			scope = this.symbols.get(namespaceKey);
			if (!scope) throw `PASymbol ${this.getCurrentNamespace()} doesn't exist.`;
			name = variableName.toUpperCase();
			symbol = scope.get(name);
		}

		if (symbol?.isConstant) throw `Can't redefine constant symbol ${this.getCurrentNamespace()}::${variableName}.`;

		scope.set(name, {
			name,
			value,
			isConstant: false,
			namespace: namespaceKey,
		});
	}

	updateSymbol(symbolName: string, value: SymbolValue) {
		let scope: Map<string, PASymbol> | undefined;
		let name = "";
		let ns = "";

		if (symbolName.includes("::")) {
			[ns, name] = symbolName.split("::") as [string, string];
			scope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
			if (scope?.has(name)) return { scope: scope, symbol: scope.get(name) as PASymbol };
		} else {
			ns = this.scopeStack[this.scopeStack.length - 1] as string;
			scope = this.symbols.get(ns);
			name = symbolName;
		}

		if (!scope) throw `PASymbol Namespace "${ns}" doesn't exist.`;

		name = name.toUpperCase();
		const symbol = scope.get(name);
		if (!symbol) throw `Unknown symbol "${ns === INTERNAL_GLOBAL ? "global" : ns}::${name}".`;

		scope.set(name, { name, value, isConstant: symbol.isConstant, namespace: ns });
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

		if (!scope) throw `ERROR: PASymbol ${ns} doesn't exist.`;

		return scope.get(name);
	}

	// test is a symbol is defined in the current NS or a specific one
	hasSymbolInScope(symbolName: string) {
		if (symbolName.includes("::")) {
			const [ns, symName] = symbolName.split("::") as [string, string];
			const targetScope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
			return targetScope?.has(symName);
		}
		const currentScope = this.getCurrentScope();
		return currentScope?.has(symbolName.toUpperCase());
	}

	lookupSymbol(symbolName: string) {
		const name = symbolName.toUpperCase();

		// Handle namespaced lookup (TOTO::LABEL)
		if (name.includes("::")) {
			const [ns, symName] = name.split("::") as [string, string];
			const targetScope = ns.toLowerCase() === "global" ? this.symbols.get(INTERNAL_GLOBAL) : this.symbols.get(ns);
			if (targetScope?.has(symName)) return targetScope.get(symName)?.value;
		}

		// Search from the local scopes up to the current scope.
		for (let i = this.scopeStack.length - 1; i >= 0; i--) {
			const scopeName = this.scopeStack[i] as string;
			const scope = this.symbols.get(scopeName);
			if (scope?.has(name)) return scope.get(name)?.value;
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
