import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";
import type { Linker } from "../linker.class";

export class OutputDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly runtime: DirectiveRuntime,
		private linker: Linker,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		const parser = this.runtime.parser;

		let size: number | undefined;
		let maxSize: number | undefined;
		const filename = parser.string().value;

		if (parser.isIdentifier("SIZE")) {
			parser.advance();
			const exprTokens = parser.getExpressionTokens(directive);
			size = this.runtime.evaluator.evaluateAsNumber(exprTokens, context);
		}

		if (parser.isIdentifier("MAXSIZE")) {
			parser.advance();
			const exprTokens = parser.getExpressionTokens(directive);
			maxSize = this.runtime.evaluator.evaluateAsNumber(exprTokens, context);
		}

		this.linker.setOutputFile(filename, size, maxSize);
	}

	public handlePassTwo(_directive: ScalarToken, _context: DirectiveContext) {}
}
