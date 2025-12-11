import type { Assembler } from "../../assembler/polyasm";
import type { DirectiveContext, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../lexer/lexer.class";

export class AssignDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		const label = context.currentGlobalLabel;
		if (!label) throw `Syntax error in line ${directive.line} - Missing symbol name before =`;

		const expressionTokens = assembler.parser.getInstructionTokens();
		const value = assembler.expressionEvaluator.evaluate(expressionTokens, context);
		assembler.symbolTable.defineVariable(label, value);
	}

	public handlePassTwo(_directive: ScalarToken, _assembler: Assembler, _context: DirectiveContext): void {}
}
