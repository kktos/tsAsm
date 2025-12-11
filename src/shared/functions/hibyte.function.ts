import type { Token } from "../../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const hibyteFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const arg = stack.pop();

	if (typeof arg !== "number") throw new Error(`.HIBYTE() requires a number argument on line ${token.line}.`);

	stack.push((arg >> 8) & 0xff);
};
