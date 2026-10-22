import type { SymbolValue } from "../../assembler/symbol.class";
import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const arrayFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, argCount): void => {
	const newArray: (SymbolValue | null)[] = [];

	for (let i = 0; i < (argCount ?? 0); i++) {
		const arg = stack.pop();
		if (arg === undefined) {
			// This should not happen if argCount is correct
			throw AsmError.at("Internal error: stack underflow for .ARRAY().", token);
		}
		newArray.unshift(arg); // unshift to maintain original argument order
	}

	stack.push(newArray);
};
