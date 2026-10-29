import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

/** `.range(start, count [, step])`: `count` numbers from `start`, `step` apart (1 by default). */
export const rangeFunction: FunctionHandler = (stack: EvaluationStack, token: Token, _symbolTable, argCount): void => {
	const step = argCount === 3 ? stack.pop() : 1;
	const count = stack.pop();
	const start = stack.pop();

	if (!Number.isInteger(start)) throw AsmError.at(`.RANGE() start: ${start} isn't a whole number.`, token);
	if (!Number.isInteger(count) || (count as number) < 0) throw AsmError.at(`.RANGE() count: ${count} isn't a whole number (0 or more).`, token);
	if (!Number.isInteger(step) || step === 0) throw AsmError.at(`.RANGE() step: ${step} isn't a whole number other than 0.`, token);

	stack.push(Array.from({ length: count as number }, (_, index) => (start as number) + index * (step as number)));
};
