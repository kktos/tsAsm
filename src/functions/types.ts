import type { PASymbolTable, SymbolValue } from "../assembler/symbol.class";
import type { Token } from "../lexer/lexer.class";

export type EvaluationStack = (SymbolValue | null)[];

export type FunctionHandler = (stack: EvaluationStack, token: Token, symbolTable: PASymbolTable, argCount?: number) => void;

export interface IFunctionDef {
	handler: FunctionHandler;
	minArgs: number;
	maxArgs: number;
}
