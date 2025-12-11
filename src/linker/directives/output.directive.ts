import type { Assembler } from "../../assembler/polyasm";
import type { DirectiveContext, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";
import type { Linker } from "../linker.class";

export class OutputDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private linker: Linker,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		const parser = this.assembler.parser;

		let size: number | undefined;
		let maxSize: number | undefined;
		const filename = parser.string().value;

		if (parser.isIdentifier("SIZE")) {
			parser.advance();
			const exprTokens = this.assembler.parser.getExpressionTokens(directive);
			size = this.assembler.expressionEvaluator.evaluateAsNumber(exprTokens, context);
		}

		if (parser.isIdentifier("MAXSIZE")) {
			parser.advance();
			const exprTokens = this.assembler.parser.getExpressionTokens(directive);
			maxSize = this.assembler.expressionEvaluator.evaluateAsNumber(exprTokens, context);
		}

		this.linker.setOutputFile(filename, size, maxSize);
	}

	public handlePassTwo(_directive: ScalarToken, _context: DirectiveContext) {}
}
