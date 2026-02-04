import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const ceilFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, _argCount): void => {
	const arg = stack.pop();

	if (typeof arg !== "number") throw new Error(`.CEIL() requires a number argument on line ${token.line}.`);

	stack.push(Math.ceil(arg));
};
