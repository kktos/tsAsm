import type { PASymbolTable } from "../../assembler/symbol.class";
import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import type { EvaluationStack, IFunctionDef } from "./types";

/**
 * `.def(name)` / `.undef(name)`: whether a symbol, or a macro when `isMacroDefined` says so, is defined at this point.
 * The name is written as is, `.def(X)`, or given as a string, `.def("X")`.
 */
export function defFunctions(isMacroDefined: (name: string) => boolean): Map<string, IFunctionDef> {
	const isDefined = (stack: EvaluationStack, token: Token, symbolTable: PASymbolTable) => {
		const name = stack.pop();
		if (typeof name !== "string") throw AsmError.at(`.${token.value}() needs a symbol name: .${token.value}(X) or .${token.value}("X").`, token);
		return symbolTable.isDefined(name) || isMacroDefined(name);
	};

	return new Map([
		["DEF", { handler: (stack, token, symbolTable) => stack.push(isDefined(stack, token, symbolTable) ? 1 : 0), minArgs: 1, maxArgs: 1, nameArgs: 1 }],
		["UNDEF", { handler: (stack, token, symbolTable) => stack.push(isDefined(stack, token, symbolTable) ? 0 : 1), minArgs: 1, maxArgs: 1, nameArgs: 1 }],
	]);
}
