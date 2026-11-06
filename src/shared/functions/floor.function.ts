import { AsmError } from "../../utils/error.utils";
import { charCode } from "../../utils/number.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const floorFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, _argCount): void => {
	const arg = charCode(stack.pop());

	if (typeof arg !== "number") throw AsmError.at(".FLOOR() requires a number argument.", token);

	stack.push(Math.floor(arg));
};
