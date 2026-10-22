import { AsmError } from "../../utils/error.utils";
import { getHex } from "../../utils/hex.util";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const hexFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, argCount): void => {
	const minDigitsArg = argCount === 2 ? stack.pop() : undefined;
	const valueArg = stack.pop();

	if (typeof valueArg !== "number") throw AsmError.at("First argument to .HEX() must be a number.", token);

	if (minDigitsArg !== undefined && typeof minDigitsArg !== "number") throw AsmError.at("Second argument to .HEX() (minDigits) must be a number.", token);

	stack.push(`$${getHex(valueArg, minDigitsArg)}`);
};
