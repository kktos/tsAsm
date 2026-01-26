import type { ExpressionEvaluator } from "../assembler/expression";
import type { EvaluationContext } from "../assembler/expression.types";
import type { Parser } from "../assembler/parser.class";
import type { FileHandler } from "../assembler/polyasm.types";
import type { PASymbolTable } from "../assembler/symbol.class";
import type { Prettify } from "../cli/schema";
import type { ILister } from "../helpers/lister.class";
import type { Logger } from "../helpers/logger.class";
import type { Linker } from "../linker/linker.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { MacroHandler } from "./macro/handler";

export type DirectiveContext = Prettify<
	EvaluationContext & {
		emitbytes: (bytes: number[]) => void;
		readSourceFile?: FileHandler["readSourceFile"];
		readBinaryFile?: FileHandler["readBinaryFile"];
		isAssembling: boolean;
		filename: string;
	}
>;

/**
 * Defines the interface for a directive handler.
 * Each directive will have a class that implements this interface.
 */
export interface IDirective {
	isBlockDirective: boolean;
	isRawDirective: boolean;

	handlePassOne(directive: ScalarToken, context: DirectiveContext): void;
	handlePassTwo(directive: ScalarToken, context: DirectiveContext): void;

	getRawBlock?(parser: Parser, instructionTokens: Token[]): Token | null;
}

export interface DirectiveRuntime {
	parser: Parser;
	symbolTable: PASymbolTable;
	evaluator: ExpressionEvaluator;
	logger: Logger;
	lister: ILister;
	linker: Linker;
	macroHandler: MacroHandler;
}
