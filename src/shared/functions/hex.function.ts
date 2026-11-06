import { AsmError } from "../../utils/error.utils";
import { getHex } from "../../utils/hex.util";
import { charCode } from "../../utils/number.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const hexFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, argCount): void => {
	// A one-character string is its character code, as wherever a number is expected: `.hex("A")` is "$41".
	const minDigitsArg = argCount === 2 ? charCode(stack.pop()) : undefined;
	const valueArg = charCode(stack.pop());

	if (typeof valueArg !== "number") throw AsmError.at("First argument to .HEX() must be a number.", token);

	if (minDigitsArg !== undefined && typeof minDigitsArg !== "number") throw AsmError.at("Second argument to .HEX() (minDigits) must be a number.", token);

	stack.push(`$${getHex(valueArg, minDigitsArg)}`);
};
