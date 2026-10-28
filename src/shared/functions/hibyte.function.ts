import { RelocValue, relocatableByte } from "../../assembler/reloc-value.class";
import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, FunctionHandler } from "./types";

export const hibyteFunction: FunctionHandler = (stack: EvaluationStack, token: Token): void => {
	const arg = stack.pop();

	// this is probably a label not yet resolved (pass 1)
	if (arg === null) {
		stack.push(null);
		return;
	}

	if (arg instanceof RelocValue) {
		stack.push(relocatableByte(arg, 8, ".HIBYTE()", token));
		return;
	}

	if (typeof arg !== "number") throw AsmError.at(".HIBYTE() requires a number argument.", token);

	stack.push((arg >> 8) & 0xff);
};
