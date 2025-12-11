import type { EvaluationContext } from "../assembler/expression";
import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";

export type DirectiveContext = Omit<EvaluationContext, "symbolTable">;

/**
 * Defines the interface for a directive handler.
 * Each directive will have a class that implements this interface.
 */
export interface IDirective {
	isBlockDirective: boolean;
	isRawDirective: boolean;

	handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void;
	handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void;
}
