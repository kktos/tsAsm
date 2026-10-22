import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const strFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, _argCount): void => {
	const valueArg = stack.pop();

	if (typeof valueArg !== "number") throw AsmError.at("First argument to .STR() must be a number.", token);

	stack.push(`${valueArg}`);
};
