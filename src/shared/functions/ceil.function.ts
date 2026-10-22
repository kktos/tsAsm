import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const ceilFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, _argCount): void => {
	const arg = stack.pop();

	if (typeof arg !== "number") throw AsmError.at(".CEIL() requires a number argument.", token);

	stack.push(Math.ceil(arg));
};
