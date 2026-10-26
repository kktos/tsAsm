import type { Parser } from "../../assembler/parser.class";
import type { PASymbolTable } from "../../assembler/symbol.class";
import type { ILister } from "../../helpers/lister.class";
import type { ScalarToken, Token } from "../../shared/lexer/lexer.class";
import { AsmError } from "../../utils/error.utils";
import { nestingDelta } from "../../utils/token.utils";
import type { MacroDefinition } from "./macro.interface";
import { isTextArg, markAsText } from "./text-arg";

const DEFAULT_MAX_MACRO_DEPTH = 32;

export class MacroHandler {
	public macroDefinitions = new Map<string, MacroDefinition>();
	/** The macros whose `.macro` this pass has reached: see `isDefined`. */
	private reached = new Set<string>();
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
		this.reached.clear();
	}

	public isMacro(name: string): boolean {
		return this.macroDefinitions.has(name);
	}

	/** The `.macro` of `name` was reached in this pass. */
	public markReached(name: string) {
		this.reached.add(name);
	}

	/** Whether the macro is defined at this point of the source, as `PASymbolTable.isDefined` for a symbol. */
	public isDefined(name: string): boolean {
		return this.reached.has(name.toUpperCase());
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

		let passedArgsArray = this.parseMacroArguments(macroToken);

		// Called from inside another macro: the arguments can use that macro's parameters.
		// Replace them now, as arguments are evaluated without any macro parameters in scope.
		const callerArgs = this.parser.tokenStreamStack.at(-1)?.macroArgs;
		const substituteArgs = this.substituteArgs;
		if (callerArgs && substituteArgs) passedArgsArray = passedArgsArray.map((argTokens) => substituteArgs(argTokens, callerArgs));

		const macroArgs = new Map<string, Token[]>();

		// Pass 2 gets back the symbols pass 1 defined in this call: its body can use them before defining them.
		const scopeName = `@@macro_${macroName}_${macroToken.line}#${this.expansionCount++}__`;
		this.symbolTable.restoreAndPushScope(scopeName, `macro ${macroToken.raw ?? macroName}`);

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

		passedArgsArray.forEach((argTokens) => this.checkValueArgument(macroName, argTokens));

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
	 * Parses the call's arguments into a list of token arrays, one for each argument.
	 * An empty argument is an error (`m 1,,3`, `m 1,`): empty text is written `{}`.
	 * A comma inside `( )` or `[ ]` belongs to the argument: `m .iif(c, 1, 2), [3, 4][0]` has two.
	 * An argument in `{ }` is text, pasted as is: `m {($12,x)}`. The others are expressions: `m <addr, >addr`.
	 * The `m(1, 2)` form needs its `(` glued to the name: `m (1+2)*3` has one argument.
	 */
	private parseMacroArguments(macroToken: ScalarToken): Token[][] {
		const argsArray: Token[][] = [];
		let currentArgTokens: Token[] = [];

		const firstPeek = this.parser.peek();
		if (!firstPeek || firstPeek.type === "EOF") return [];
		const hasParens =
			firstPeek.type === "OPERATOR" &&
			firstPeek.value === "(" &&
			firstPeek.line === macroToken.line &&
			firstPeek.column === macroToken.column + macroToken.value.length;

		// Without parentheses, the arguments end with the call's line.
		const isEnd = (token: Token | null): token is null => !token || token.type === "EOF" || (!hasParens && token.line !== macroToken.line);

		// The commas separating the arguments are at this depth: inside the call's ( ), or outside any.
		const argDepth = hasParens ? 1 : 0;
		if (hasParens) this.parser.advance(1); // consume opening '('
		let depth = argDepth;
		let lastComma: Token | undefined;

		// An argument next to a comma can't be empty. Without any comma, an empty argument list is a call without arguments.
		const pushArgument = () => {
			if (lastComma && currentArgTokens.length === 0 && !isTextArg(currentArgTokens))
				throw AsmError.at(
					`Macro '${macroToken.value}': argument ${argsArray.length + 1} is empty. An argument is a value; pass empty text as {}.`,
					lastComma,
				);
			argsArray.push(currentArgTokens);
		};

		while (true) {
			const token = this.parser.peek();
			if (isEnd(token)) break;
			this.parser.advance(1);

			if (token.type === "COMMA" && depth === argDepth) {
				lastComma = token;
				pushArgument();
				currentArgTokens = [];
				continue;
			}

			// '{' starts a text argument as its first token: '<' and '>' are low and high byte, as in any expression.
			if (depth === argDepth && currentArgTokens.length === 0 && token.type === "LBRACE") {
				currentArgTokens = markAsText(this.readTextArgument(hasParens ? undefined : macroToken.line));
				const next = this.parser.peek();
				const endsHere = isEnd(next) || next.type === "COMMA" || (hasParens && next.type === "OPERATOR" && next.value === ")");
				if (!endsHere) throw AsmError.at(`Unexpected '${next.value}' after '}': a macro argument in { } ends at its '}'.`, next);
				continue;
			}

			depth += nestingDelta(token);
			if (hasParens && depth === 0) {
				pushArgument();
				return this.withoutEmptyCall(argsArray); // finished argument list
			}

			currentArgTokens.push(token);
		}

		if (lastComma || currentArgTokens.length > 0 || isTextArg(currentArgTokens)) pushArgument();
		return this.withoutEmptyCall(argsArray);
	}

	/** The tokens up to the `}` matching an already consumed `{`. Without parentheses, they must be on the call's `line`. */
	private readTextArgument(line?: string | number): Token[] {
		const tokens: Token[] = [];
		let braceDepth = 1;
		while (true) {
			const token = this.parser.peek();
			if (!token || token.type === "EOF" || (line !== undefined && token.line !== line)) throw new Error("Unmatched '{' in macro arguments.");
			this.parser.advance(1);
			if (token.type === "LBRACE") braceDepth++;
			if (token.type === "RBRACE" && --braceDepth === 0) return tokens;
			tokens.push(token);
		}
	}

	/**
	 * An argument not in { } is a value: an expression. An addressing mode isn't one, it's passed as text:
	 * `#` isn't an operator, and a comma in ( ) only separates a function's arguments: `m ($12,x)` needs `m {($12,x)}`.
	 */
	private checkValueArgument(macroName: string, argTokens: Token[]) {
		if (isTextArg(argTokens)) return;

		// For each open ( or [: can it hold commas (an array, a function's arguments)?
		const openings: boolean[] = [];
		const isAddressingMode = argTokens.some((token, index) => {
			if (token.type === "COMMA") return openings.at(-1) === false;
			if (token.type !== "OPERATOR") return false;
			if (token.value === "#") return true;
			if (token.value === "[") openings.push(true);
			if (token.value === "(") openings.push(argTokens[index - 1]?.type === "IDENTIFIER");
			if (token.value === ")" || token.value === "]") openings.pop();
			return false;
		});
		if (!isAddressingMode) return;

		const text = argTokens.map((token) => token.raw ?? token.value).join("");
		throw AsmError.at(
			`Macro '${macroName}': '${text}' is an addressing mode, not an expression. Pass it as text, in { }: {${text}}.`,
			argTokens[0] as Token,
		);
	}

	private withoutEmptyCall(argsArray: Token[][]): Token[][] {
		// If the original tokens were empty, or if the only argument found is empty,
		// it means there were no actual arguments. An empty `{}` is one.
		const [first] = argsArray;
		if (argsArray.length === 1 && first?.length === 0 && !isTextArg(first)) return [];

		return argsArray;
	}
}
