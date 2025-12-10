import type { Token } from "../lexer/lexer.class";
import type { SymbolValue } from "../symbol.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const iifFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const falseValue = stack.pop() as SymbolValue;
	const trueValue = stack.pop() as SymbolValue;
	const condition = stack.pop();

	if (typeof condition !== "number") throw new Error(`First argument to .IIF() must be a number on line ${token.line}.`);

	const result = condition !== 0 ? trueValue : falseValue;

	stack.push(result);
};
