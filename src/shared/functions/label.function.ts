import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const labelFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, _argCount, resolver): void => {
	const arg = stack.pop();

	if (typeof arg !== "string") throw new Error(`.LABEL() requires a string argument on line ${token.line}.`);
	if (!resolver) throw new Error(`Internal error: .LABEL() requires a resolver on line ${token.line}.`);

	const val = resolver(arg);

	if (val === undefined) throw new Error(`Undefined symbol '${arg}' on line ${token.line}.`);

	stack.push(val);
};
