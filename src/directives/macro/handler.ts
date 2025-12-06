import type { ScalarToken, Token } from "../../lexer/lexer.class";
import type { Logger } from "../../logger.class";
import type { Assembler } from "../../polyasm";

export class MacroHandler {
	private assembler: Assembler;
	private logger: Logger;

	constructor(assembler: Assembler, logger: Logger) {
		this.assembler = assembler;
		this.logger = logger;
	}

	public isMacro(name: string): boolean {
		return this.assembler.macroDefinitions.has(name);
	}

	/** Pass 2: Expands a macro by injecting its tokens into the stream with argument substitution. */
	public expandMacro(macroToken: ScalarToken) {
		const macroName = macroToken.value;
		const definition = this.assembler.macroDefinitions.get(macroName);

		if (!definition) throw new Error(`ERROR: Macro '${macroName}' not defined.`);

		this.logger.log(`Expanding macro: ${macroName}`);

		const passedArgsArray = this.parseMacroArguments(macroToken.line);
		const macroArgs = new Map<string, Token[]>();

		const scopeName = `__MACRO_${macroName}_${macroToken.line}__`;
		this.assembler.symbolTable.pushScope(scopeName);

		// Argument validation and mapping
		if (definition.restParameter) {
			if (passedArgsArray.length < definition.parameters.length)
				throw new Error(
					`Not enough arguments for macro '${macroName}' on line ${macroToken.line}. Expected at least ${definition.parameters.length}, but got ${passedArgsArray.length}.`,
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
				throw new Error(`line ${macroToken.line} Macro '${macroName}' expected ${definition.parameters.length}, but got ${passedArgsArray.length}.`);

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

		this.assembler.parser.pushTokenStream({ newTokens, macroArgs, onEndOfStream: () => this.assembler.symbolTable.popScope() });
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

		const firstPeek = this.assembler.parser.peek();
		if (!firstPeek || firstPeek.type === "EOF") return [];
		const hasParens = firstPeek.type === "OPERATOR" && firstPeek.value === "(";
		const callLineNum = callLine ?? firstPeek.line;

		if (hasParens) {
			// consume opening '('
			this.assembler.parser.consume(1);
			parenDepth = 1;
			while (true) {
				const token = this.assembler.parser.peek();
				if (!token || token.type === "EOF") break;
				this.assembler.parser.consume(1);

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
				const token = this.assembler.parser.peek();
				if (!token || token.type === "EOF" || token.line !== callLineNum) break;

				// Handle angle-bracketed arguments
				if (token.type === "OPERATOR" && token.value === "<") {
					this.assembler.parser.consume(1); // consume '<'
					let bracketDepth = 1;
					while (bracketDepth > 0) {
						const innerToken = this.assembler.parser.peek();
						if (!innerToken || innerToken.type === "EOF" || innerToken.line !== callLineNum) {
							throw new Error(`Unmatched '<' in macro arguments on line ${callLineNum}.`);
						}
						this.assembler.parser.consume(1);
						if (innerToken.type === "OPERATOR") {
							if (innerToken.value === "<") bracketDepth++;
							if (innerToken.value === ">") bracketDepth--;
						}

						if (bracketDepth > 0) {
							currentArgTokens.push(innerToken);
						}
					}
				} else {
					this.assembler.parser.consume(1);
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
