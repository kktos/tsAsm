import type { EvaluationContext } from "../expression";
import type { ScalarToken } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";

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
