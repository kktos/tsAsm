import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const lenFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const arg = stack.pop();

	if (typeof arg !== "string" && !Array.isArray(arg)) throw AsmError.at(".LEN() requires a string or array argument.", token);

	stack.push(arg.length);
};
