import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const lobyte: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const arg = stack.pop();

	if (typeof arg !== "number") throw new Error(`.LOBYTE() requires a number argument on line ${token.line}.`);

	stack.push(arg & 0xff);
};
