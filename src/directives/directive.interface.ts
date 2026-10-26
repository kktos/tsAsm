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
import type { DefinitionSite, IncludeStack } from "../utils/error.utils";
import type { MacroHandler } from "./macro/handler";

export type DirectiveContext = Prettify<
	EvaluationContext & {
		emitbytes: (bytes: number[]) => void;
		readSourceFile?: FileHandler["readSourceFile"];
		readBinaryFile?: FileHandler["readBinaryFile"];
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

	/** Called right after the directive's name, even inside a block: returns the rest of its tokens, raw text included. */
	getRawBlock?(parser: Parser, directive: Token): Token[];
}

export interface DirectiveRuntime {
	parser: Parser;
	symbolTable: PASymbolTable;
	evaluator: ExpressionEvaluator;
	logger: Logger;
	lister: ILister;
	linker: Linker;
	macroHandler: MacroHandler;
	/** Reports a warning, located like an error: at `position`, else at the current statement. */
	warn: (message: string, position?: { line: number | string; column: number }) => void;
	/** The first token of the statement being assembled: where its errors are located, and where what it defines is. */
	currentStatement: () => Token | undefined;
	/** Where something defined at `position` is, for a note about it: see `ErrorLocator.definitionSite`. */
	definitionSite: (position: { line: number | string; column: number }) => DefinitionSite;
	/** Where an `.include` at `position` is, for the include chain of the file it reads: see `StreamManager.startNewStream`. */
	includeSites: (position: { line: number | string; column: number }) => IncludeStack;
}
