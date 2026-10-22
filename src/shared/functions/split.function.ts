import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const splitFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, argCount): void => {
	const delimiterArg = argCount === 2 ? stack.pop() : " ";
	const stringArg = stack.pop();

	if (typeof stringArg !== "string") {
		throw AsmError.at("First argument to .SPLIT() must be a string.", token);
	}
	if (typeof delimiterArg !== "string") {
		throw AsmError.at("Second argument to .SPLIT() (delimiter) must be a string.", token);
	}

	stack.push(stringArg.split(delimiterArg));
};
