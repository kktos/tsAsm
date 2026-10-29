import type { SymbolValue } from "../../assembler/symbol.class";
import { UserFunction } from "../../assembler/user-function.class";
import { AsmError } from "../../utils/error.utils";
import type { IFunctionDef } from "./types";

/**
 * `.symbol(name)`, in a linker script: the value of the assembled source's symbol `name`, global or `ns::name`,
 * that `findSourceSymbol` gives.
 */
export function symbolFunction(findSourceSymbol: (name: string) => SymbolValue | undefined): IFunctionDef {
	return {
		handler: (stack, token) => {
			const name = stack.pop();
			if (typeof name !== "string") throw AsmError.at("Argument to .SYMBOL() must be a string.", token);
			const value = findSourceSymbol(name);
			if (value === undefined) throw AsmError.at(`Symbol '${name}' isn't defined in the source.`, token);
			if (value instanceof UserFunction) throw AsmError.at(`'${name}' is a function of the source: .SYMBOL() reads a value.`, token);
			stack.push(value);
		},
		minArgs: 1,
		maxArgs: 1,
	};
}
