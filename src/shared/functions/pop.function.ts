import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const popFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const arrayArg = stack.pop();

	if (!Array.isArray(arrayArg) || arrayArg.length === 0) {
		throw AsmError.at("Argument to .POP() must be a non-empty array.", token);
	}

	stack.push(arrayArg[arrayArg.length - 1]);
};
