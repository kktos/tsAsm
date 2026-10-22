import type { SymbolValue } from "../../assembler/symbol.class";
import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const iifFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const falseValue = stack.pop() as SymbolValue;
	const trueValue = stack.pop() as SymbolValue;
	const condition = stack.pop();

	if (typeof condition !== "number") throw AsmError.at("First argument to .IIF() must be a number.", token);

	const result = condition !== 0 ? trueValue : falseValue;

	stack.push(result);
};
