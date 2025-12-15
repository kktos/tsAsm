import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";

export class LinkerSegmentDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const name = this.runtime.parser.identifier();

		this.runtime.parser.identifier("AT");

		const expressionTokens = this.runtime.parser.getInstructionTokens(directive);
		const offset = this.runtime.evaluator.evaluateAsNumber(expressionTokens, context);

		this.runtime.linker.addLinkerSegment(name.value, offset);
	}

	public handlePassOne(_directive: ScalarToken, _context: DirectiveContext) {}
}
