import type { PASymbolTable, SymbolValue } from "../../assembler/symbol.class";
import type { Token } from "../lexer/lexer.class";

export type EvaluationStack = (SymbolValue | null)[];

export type SymbolResolver = (name: string) => SymbolValue | null | undefined;

export type FunctionHandler = (stack: EvaluationStack, token: Token, symbolTable: PASymbolTable, argCount?: number, resolver?: SymbolResolver) => void;

export interface IFunctionDef {
	handler: FunctionHandler;
	minArgs: number;
	maxArgs: number;
	/**
	 * How many leading arguments must be known for the result to be: in pass 1, if one isn't (a symbol defined later),
	 * the call gives null (not known yet) without running the handler, as the operators do. All of them by default.
	 */
	knownArgs?: number;
}
