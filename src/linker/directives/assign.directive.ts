import type { Assembler } from "../../assembler/polyasm";
import type { DirectiveContext, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";

export class AssignDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly assembler: Assembler) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const label = context.currentGlobalLabel;
		if (!label) throw `Syntax error in line ${directive.line} - Missing symbol name before =`;

		const expressionTokens = this.assembler.parser.getInstructionTokens();
		const value = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		this.assembler.symbolTable.assignVariable(label, value);
	}

	public handlePassTwo(_directive: ScalarToken, _context: DirectiveContext): void {}
}
