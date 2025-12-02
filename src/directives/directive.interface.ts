import type { EvaluationContext } from "../expression";
import type { ScalarToken } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";

export type DirectiveContext = Omit<EvaluationContext, "symbolTable">;

/**
 * Defines the interface for a directive handler.
 * Each directive will have a class that implements this interface.
 */
export interface IDirective {
	/** Handles the processing of the directive during Pass 1. */
	handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void;

	/**
	 * Handles the processing of the directive during Pass 2 (code generation).
	 */
	handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void;
}
