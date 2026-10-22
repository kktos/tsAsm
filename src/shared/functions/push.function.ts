import type { SymbolValue } from "../../assembler/symbol.class";
import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const pushFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, argCount): void => {
	const itemsToAdd: SymbolValue[] = [];
	for (let i = 0; i < (argCount ?? 0) - 1; i++) itemsToAdd.unshift(stack.pop() as SymbolValue); // Pop items and reverse order
	const arrayArg = stack.pop();
	if (!Array.isArray(arrayArg)) throw AsmError.at("First argument to .PUSH() must be an array.", token);
	// Return a new array, do not mutate the original
	const newArray = [...arrayArg, ...itemsToAdd];
	stack.push(newArray);
};
