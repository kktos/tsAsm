import { StructType } from "../../assembler/struct-type.class";
import type { PASymbolTable } from "../../assembler/symbol.class";
import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack } from "./types";

/**
 * `.size(Sprite)`: a struct's size; `.size(player)`, its instance's. The name is written as is, or given as a string.
 * In pass 1, a symbol defined later isn't known yet: null.
 */
export function sizeFunction(
	stack: EvaluationStack,
	token: Token,
	symbolTable: PASymbolTable,
	_argCount?: number,
	_resolver?: unknown,
	allowForwardRef?: boolean,
) {
	const arg = stack.pop();
	if (arg instanceof StructType) {
		stack.push(StructType.sizeOf(arg));
		return;
	}
	if (typeof arg !== "string") throw AsmError.at(".SIZE() takes a struct, or an instance of one: .size(Sprite), .size(player).", token);

	const value = symbolTable.lookupSymbol(arg);
	if (value instanceof StructType) {
		stack.push(StructType.sizeOf(value));
		return;
	}
	const struct = symbolTable.structOf(arg);
	if (struct) {
		stack.push(StructType.sizeOf(struct));
		return;
	}
	if (value === undefined && allowForwardRef) {
		stack.push(null);
		return;
	}
	if (value === undefined) throw AsmError.at(`Undefined symbol '${arg}'.`, token);
	throw AsmError.at(`.SIZE() takes a struct, or an instance of one: '${arg}' is neither.`, token);
}
