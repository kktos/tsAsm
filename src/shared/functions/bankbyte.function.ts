import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const bankbyteFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const arg = stack.pop();

	// this is probably a label not yet resolved (pass 1)
	if (arg === null) {
		stack.push(null);
		return;
	}

	if (typeof arg !== "number") throw AsmError.at(`.${String(token.value).toUpperCase()}() requires a number argument.`, token);

	stack.push((arg >> 16) & 0xff);
};
