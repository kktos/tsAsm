import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const typeFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const arg = stack.pop();

	if (arg === undefined) {
		// This should not happen with the centralized argument validation
		throw AsmError.at("Internal error: stack underflow for .TYPE().", token);
	}

	let typeString: string;

	if (typeof arg === "string") {
		typeString = "string";
	} else if (typeof arg === "number") {
		typeString = "number";
	} else if (Array.isArray(arg)) {
		typeString = "array";
	} else {
		typeString = "unknown";
	}

	stack.push(typeString);
};
