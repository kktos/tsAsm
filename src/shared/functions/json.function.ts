import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const jsonFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const arg = stack.pop();

	if (arg === undefined) {
		// This should not happen with the centralized argument validation
		throw AsmError.at("Internal error: stack underflow for .JSON().", token);
	}

	const jsonString = JSON.stringify(arg);
	stack.push(jsonString);
};
