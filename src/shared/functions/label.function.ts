import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const labelFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, _argCount, resolver): void => {
	const arg = stack.pop();

	if (typeof arg !== "string") throw AsmError.at(".LABEL() requires a string argument.", token);
	if (!resolver) throw AsmError.at("Internal error: .LABEL() requires a resolver.", token);

	const val = resolver(arg);

	if (val === undefined) throw AsmError.at(`Undefined symbol '${arg}'.`, token);

	stack.push(val);
};
