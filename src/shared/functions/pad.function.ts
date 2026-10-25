import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

/** `.PAD(value, width [, fill])`: right-aligned in `width` columns, or left-aligned when `width` is negative. Never truncates. */
export const padFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, argCount): void => {
	const fillArg = argCount === 3 ? stack.pop() : " ";
	const widthArg = stack.pop();
	const valueArg = stack.pop();

	if (typeof valueArg !== "string" && typeof valueArg !== "number") throw AsmError.at("First argument to .PAD() must be a string or a number.", token);
	if (typeof widthArg !== "number" || !Number.isInteger(widthArg)) throw AsmError.at("Second argument to .PAD() (width) must be an integer.", token);
	if (typeof fillArg !== "string" || fillArg.length !== 1) throw AsmError.at("Third argument to .PAD() (fill) must be a single character.", token);

	const text = `${valueArg}`;
	stack.push(widthArg < 0 ? text.padEnd(-widthArg, fillArg) : text.padStart(widthArg, fillArg));
};
