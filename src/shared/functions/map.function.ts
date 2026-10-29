import type { SymbolValue } from "../../assembler/symbol.class";
import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import { type EvaluationStack, FunctionRef, type FunctionHandler } from "./types";

/** `.map(array, function)`: a new array, of the function's value for each element. */
export const mapFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, _argCount, _resolver, _allowForwardRef, call): void => {
	const fn = stack.pop();
	const array = stack.pop();

	if (!Array.isArray(array)) throw AsmError.at("First argument to .MAP() must be an array.", token);
	if (!(fn instanceof FunctionRef) || !call)
		throw AsmError.at("Second argument to .MAP() must be a function, by its name: .map(list, f) or .map(list, .lobyte).", token);

	const [min, max] = fn.arity;
	if (min > 1 || max < 1)
		throw AsmError.at(
			`.MAP() calls its function with one argument, each element: '${fn}' takes ${min === max ? min : max === Number.POSITIVE_INFINITY ? `${min} or more` : `${min} to ${max}`}.`,
			token,
		);

	// Pass 1: an element not known yet stays so (null), as in an array literal, and the array keeps its length.
	stack.push(array.map((element) => call(fn, [element]) as SymbolValue));
};
