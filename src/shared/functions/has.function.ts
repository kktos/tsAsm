import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

/** `.HAS(object, key)`: 1 if the object has the field `key`, as written, else 0. */
export const hasFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const key = stack.pop();
	const object = stack.pop();

	if (typeof object !== "object" || object === null || Array.isArray(object)) throw AsmError.at("First argument to .HAS() must be an object.", token);
	if (typeof key !== "string") throw AsmError.at("Second argument to .HAS() (key) must be a string.", token);

	stack.push(Object.hasOwn(object, key) ? 1 : 0);
};
