import { getHex } from "../../utils/hex.util";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const hexFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, argCount): void => {
	const minDigitsArg = argCount === 2 ? stack.pop() : undefined;
	const valueArg = stack.pop();

	if (typeof valueArg !== "number") throw new Error(`First argument to .HEX() must be a number on line ${token.line}.`);

	if (minDigitsArg !== undefined && typeof minDigitsArg !== "number")
		throw new Error(`Second argument to .HEX() (minDigits) must be a number on line ${token.line}.`);

	stack.push(`$${getHex(valueArg, minDigitsArg)}`);
};
