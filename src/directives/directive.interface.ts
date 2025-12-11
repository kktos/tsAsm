import type { EvaluationContext } from "../assembler/expression";
import type { Prettify } from "../cli/schema";
import type { ScalarToken } from "../shared/lexer/lexer.class";

export type DirectiveContext = Prettify<
	Omit<EvaluationContext, "symbolTable"> & {
		writebytes: (bytes: number[]) => void;
		isAssembling: boolean;
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
}
