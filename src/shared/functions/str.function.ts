import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const strFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, _argCount): void => {
	const valueArg = stack.pop();

	if (typeof valueArg !== "number") throw new Error(`First argument to .STR() must be a number on line ${token.line}.`);

	stack.push(`${valueArg}`);
};
