import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";

export class SectionDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const name = this.runtime.parser.identifier();

		if (this.runtime.parser.isIdentifier("AT")) {
			this.runtime.parser.advance();
			const expressionTokens = this.runtime.parser.getInstructionTokens(directive);
			const offset = this.runtime.evaluator.evaluateAsNumber(expressionTokens, context);
			this.runtime.linker.addLinkerSection(name.value, offset);
		} else {
			this.runtime.linker.addInlineSection(name.value);
		}
	}

	public handlePassOne(_directive: ScalarToken, _context: DirectiveContext) {}
}
