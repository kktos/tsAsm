import type { Assembler } from "../../assembler/polyasm";
import type { DirectiveContext, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../lexer/lexer.class";
import type { Linker } from "../linker.class";

export class OutputDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private linker: Linker) {}

	public handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		const parser = assembler.parser;

		let size: number | undefined;
		let maxSize: number | undefined;
		const filename = parser.string().value;

		if (parser.isIdentifier("SIZE")) {
			parser.consume();
			const exprTokens = assembler.parser.getExpressionTokens(directive);
			size = assembler.expressionEvaluator.evaluateAsNumber(exprTokens, context);
		}

		if (parser.isIdentifier("MAXSIZE")) {
			parser.consume();
			const exprTokens = assembler.parser.getExpressionTokens(directive);
			maxSize = assembler.expressionEvaluator.evaluateAsNumber(exprTokens, context);
		}

		this.linker.setOutputFile(filename, size, maxSize);
	}

	public handlePassTwo(_directive: ScalarToken, _assembler: Assembler, _context: DirectiveContext) {}
}
