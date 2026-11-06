import { AsmError } from "../../utils/error.utils";
import { charCode } from "../../utils/number.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

/**
 * `.STR(value [, radix])`: a number written in `radix` (10 by default, 2 to 36, its digits over 9 in upper case), or
 * a string as is.
 */
export const strFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, argCount): void => {
	// The radix is a number: a one-character string is its character code. The value stays text.
	const radixArg = argCount === 2 ? charCode(stack.pop()) : undefined;
	const valueArg = stack.pop();

	if (typeof valueArg !== "number" && typeof valueArg !== "string")
		throw AsmError.at("First argument to .STR() must be a number or a string: .JSON() writes an array or an object.", token);
	if (radixArg !== undefined && (typeof radixArg !== "number" || !Number.isInteger(radixArg) || radixArg < 2 || radixArg > 36))
		throw AsmError.at("Second argument to .STR() (radix) must be an integer from 2 to 36.", token);
	if (radixArg !== undefined && typeof valueArg === "string") throw AsmError.at("A radix writes a number: .STR() gives a string as is.", token);

	stack.push(typeof valueArg === "string" ? valueArg : valueArg.toString(radixArg ?? 10).toUpperCase());
};
