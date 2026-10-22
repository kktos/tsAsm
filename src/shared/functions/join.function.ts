import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const joinFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const separator = stack.pop();
	const arrayArg = stack.pop();

	if (!Array.isArray(arrayArg)) {
		throw AsmError.at("First argument to .JOIN() must be an array.", token);
	}

	if (typeof separator !== "string") {
		throw AsmError.at("Second argument to .JOIN() must be a string.", token);
	}

	// The native join method handles converting number elements to strings automatically.
	stack.push(arrayArg.join(separator));
};
