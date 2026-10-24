import type { Parser } from "../../assembler/parser.class";
import type { PASymbolTable } from "../../assembler/symbol.class";
import type { ILister } from "../../helpers/lister.class";
import type { ScalarToken, Token } from "../../shared/lexer/lexer.class";
import { AsmError } from "../../utils/error.utils";
import type { MacroDefinition } from "./macro.interface";

const DEFAULT_MAX_MACRO_DEPTH = 32;

export class MacroHandler {
	public macroDefinitions = new Map<string, MacroDefinition>();
	/** Expansions done in this pass: numbers each call's scope, the same in both passes (a loop calls from the same line). */
	private expansionCount = 0;

	constructor(
		private readonly parser: Parser,
		private readonly symbolTable: PASymbolTable,
		private readonly lister: ILister,
		/** Maximum number of nested macro expansions. */
		private readonly maxDepth = DEFAULT_MAX_MACRO_DEPTH,
		/** Replaces macro parameters in tokens by their arguments. Needed to forward parameters to a nested macro call. */
		private readonly substituteArgs?: (tokens: Token[], macroArgs: Map<string, Token[]>) => Token[],
	) {}

	/** At the start of a pass: the expansions are numbered from 0 again, so pass 2 finds pass 1's scopes. */
	public rewind() {
		this.expansionCount = 0;
	}

	public isMacro(name: string): boolean {
		return this.macroDefinitions.has(name);
	}

	/** Pass 2: Expands a macro by injecting its tokens into the stream with argument substitution. */
	public expandMacro(macroToken: ScalarToken) {
		const macroName = macroToken.value;
		const definition = this.macroDefinitions.get(macroName);

		if (!definition) throw new Error(`Macro '${macroName}' not defined.`);

		// Stop runaway recursion before it exhausts memory.
		const activeExpansions = this.parser.tokenStreamStack.filter((stream) => stream.macroName).length;
		if (activeExpansions >= this.maxDepth)
			throw AsmError.at(`Macro '${macroName}' nested more than ${this.maxDepth} levels deep. Is it recursive without an end condition?`, macroToken);

		let passedArgsArray = this.parseMacroArguments(macroToken.line);

		// Called from inside another macro: the arguments can use that macro's parameters.
		// Replace them now, as arguments are evaluated without any macro parameters in scope.
		const callerArgs = this.parser.tokenStreamStack.at(-1)?.macroArgs;
		const substituteArgs = this.substituteArgs;
		if (callerArgs && substituteArgs) passedArgsArray = passedArgsArray.map((argTokens) => substituteArgs(argTokens, callerArgs));

		const macroArgs = new Map<string, Token[]>();

		// Pass 2 gets back the symbols pass 1 defined in this call: its body can use them before defining them.
		const scopeName = `@@macro_${macroName}_${macroToken.line}#${this.expansionCount++}__`;
		this.symbolTable.restoreAndPushScope(scopeName);

		// Argument validation and mapping
		if (definition.restParameter) {
			if (passedArgsArray.length < definition.parameters.length)
				throw AsmError.at(
					`Not enough arguments for macro '${macroName}'. Expected at least ${definition.parameters.length}, but got ${passedArgsArray.length}.`,
					macroToken,
				);

			// Map regular parameters
			definition.parameters.forEach((param, index) => {
				const argTokens = passedArgsArray[index] || [];
				macroArgs.set(param.toUpperCase(), argTokens);
			});

			// Map rest parameter
			const restArgs = passedArgsArray.slice(definition.parameters.length);

			const arrayToken: Token = {
				type: "ARRAY",
				line: macroToken.line,
				column: macroToken.column,
				value: restArgs,
			};

			macroArgs.set(definition.restParameter, [arrayToken]);
		} else {
			// Original logic for fixed arguments
			if (passedArgsArray.length !== definition.parameters.length)
				throw new Error(
					`Macro '${macroName}' expects ${definition.parameters.length} argument${definition.parameters.length === 1 ? "" : "s"}, but got ${passedArgsArray.length}.`,
				);

			definition.parameters.forEach((param, index) => {
				const argTokens = passedArgsArray[index] || [];
				macroArgs.set(param.toUpperCase(), argTokens);
			});
		}

		// Create a clean copy of the body tokens with updated line numbers.
		const newTokens = definition.body.map((bodyToken) => ({
			...bodyToken,
			line: `${macroToken.line}.${bodyToken.line}`,
		}));

		this.lister.macro(macroToken.raw as string, passedArgsArray);

		this.parser.pushTokenStream({
			newTokens,
			macroArgs,
			macroName,
			macroCall: macroToken,
			onEndOfStream: () => this.symbolTable.popScope({ wannaSave: true }),
		});
	}

	/**
	 * Parses a list of argument tokens into a list of token arrays, one for each argument.
	 * This method correctly handles empty arguments (e.g., `arg1,,arg3`).
	 * @param argTokens The tokens to parse.
	 */
	private parseMacroArguments(callLine?: string | number): Token[][] {
		const argsArray: Token[][] = [];
		let currentArgTokens: Token[] = [];
		let parenDepth = 0;

		const firstPeek = this.parser.peek();
		if (!firstPeek || firstPeek.type === "EOF") return [];
		const hasParens = firstPeek.type === "OPERATOR" && firstPeek.value === "(";
		const callLineNum = callLine ?? firstPeek.line;

		if (hasParens) {
			// consume opening '('
			this.parser.advance(1);
			parenDepth = 1;
			while (true) {
				const token = this.parser.peek();
				if (!token || token.type === "EOF") break;
				this.parser.advance(1);

				if (token.type === "OPERATOR" && token.value === "(") {
					parenDepth++;
					currentArgTokens.push(token);
					continue;
				}

				if (token.type === "OPERATOR" && token.value === ")") {
					parenDepth--;
					if (parenDepth === 0) {
						argsArray.push(currentArgTokens);
						currentArgTokens = [];
						break; // finished argument list
					}
					currentArgTokens.push(token);
					continue;
				}

				if (token.type === "COMMA" && parenDepth === 1) {
					argsArray.push(currentArgTokens);
					currentArgTokens = [];
					continue;
				}

				currentArgTokens.push(token);
			}
		} else {
			// No parentheses: only take tokens on the same line as the macro call
			while (true) {
				const token = this.parser.peek();
				if (!token || token.type === "EOF" || token.line !== callLineNum) break;

				// Handle angle-bracketed arguments
				if (token.type === "OPERATOR" && token.value === "<") {
					this.parser.advance(1); // consume '<'
					let bracketDepth = 1;
					while (bracketDepth > 0) {
						const innerToken = this.parser.peek();
						if (!innerToken || innerToken.type === "EOF" || innerToken.line !== callLineNum) {
							throw new Error("Unmatched '<' in macro arguments.");
						}
						this.parser.advance(1);
						if (innerToken.type === "OPERATOR") {
							if (innerToken.value === "<") bracketDepth++;
							if (innerToken.value === ">") bracketDepth--;
						}

						if (bracketDepth > 0) {
							currentArgTokens.push(innerToken);
						}
					}
				} else {
					this.parser.advance(1);
					if (token.type === "COMMA") {
						argsArray.push(currentArgTokens);
						currentArgTokens = [];
					} else {
						currentArgTokens.push(token);
					}
				}
			}
			if (currentArgTokens.length > 0) argsArray.push(currentArgTokens);
		}

		// If the original tokens were empty, or if the only argument found is empty,
		// it means there were no actual arguments.
		if (argsArray.length === 1 && argsArray[0]?.length === 0) return [];

		return argsArray;
	}
}
