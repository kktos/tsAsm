import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";

export class OutputDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(_directive: ScalarToken, _context: DirectiveContext) {}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const parser = this.runtime.parser;

		let fixedSize: number | undefined;
		let maxSize: number | undefined;
		let padValue = 0;
		const filename = parser.string().value;

		if (parser.isIdentifier("FIXED")) {
			parser.advance();
			const exprTokens = parser.getExpressionTokens(directive);
			fixedSize = this.runtime.evaluator.evaluateAsNumber(exprTokens, context);

			if (parser.isIdentifier("PAD")) {
				parser.advance();
				const exprTokens = parser.getExpressionTokens(directive);
				padValue = this.runtime.evaluator.evaluateAsNumber(exprTokens, context);
			}
		} else if (parser.isIdentifier("MAX")) {
			parser.advance();
			const exprTokens = parser.getExpressionTokens(directive);
			maxSize = this.runtime.evaluator.evaluateAsNumber(exprTokens, context);
		}

		this.runtime.linker.setOutputFile(filename, fixedSize, padValue, maxSize);
	}
}
