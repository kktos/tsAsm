import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";

export class AssignDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const label = context.currentLabel;
		if (!label) throw `Syntax error in line ${directive.line} - Missing symbol name before =`;

		const expressionTokens = this.runtime.parser.getInstructionTokens();
		const value = this.runtime.evaluator.evaluate(expressionTokens, context);
		this.runtime.symbolTable.assignVariable(label, value);
	}

	public handlePassTwo(_directive: ScalarToken, _context: DirectiveContext): void {}
}
