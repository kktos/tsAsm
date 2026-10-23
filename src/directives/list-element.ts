import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { undefinedSymbolName } from "../utils/symbol.utils";
import type { DirectiveContext, DirectiveRuntime } from "./directive.interface";

/** An element of a directive's comma-separated list: the tokens it was read from, and its values. */
export type ListElement = { tokens: Token[]; values: (SymbolValue | null)[] };

/**
 * Reads the next element of a directive's comma-separated list. It's one expression, with one value, or a spread:
 * `...array` gives each of the array's elements, as if they were written there (`.db 1, ...table, 2`).
 * For a spread, `tokens` starts with the `...`, so an error about one of its elements points there.
 */
export function readListElement(runtime: DirectiveRuntime, directive: ScalarToken, context: DirectiveContext): ListElement {
	const { parser, evaluator } = runtime;

	const spread = parser.is("REST_OPERATOR") ? (parser.next() as Token) : undefined;
	const exprTokens = parser.getExpressionTokens(directive);
	if (!spread) return { tokens: exprTokens, values: [evaluator.evaluate(exprTokens, context)] };

	if (exprTokens.length === 0) throw AsmError.at(`.${directive.value}: '...' must be followed by an array.`, spread);

	const value = evaluator.evaluate(exprTokens, context);
	// Not known yet (pass 1): its number of elements is needed to place what follows.
	if (value === null)
		throw AsmError.at(
			`.${directive.value}: ${undefinedSymbolName(exprTokens, context, runtime.symbolTable)} must be defined before it is used here (its length is needed to place what follows).`,
			spread,
		);
	if (!Array.isArray(value)) {
		const kind = typeof value === "object" ? "an object" : `a ${typeof value}`;
		throw AsmError.at(`.${directive.value}: '...' must be followed by an array, not ${kind}.`, spread);
	}

	// A macro's rest parameter holds each argument as its tokens: evaluated like a macro argument, without the macro's own.
	const values = value.map((item) => (Array.isArray(item) && item[0]?.type ? evaluator.evaluate(item as Token[], { ...context, macroArgs: undefined }) : item));
	return { tokens: [spread, ...exprTokens], values };
}
