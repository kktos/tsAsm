import type { Assembler } from "../assembler/polyasm";
import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class NamespaceDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	constructor(private readonly assembler: Assembler) {}
	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		this.setNamespace(directive, context);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		this.setNamespace(directive, context);
	}

	private setNamespace(directive: ScalarToken, context: DirectiveContext): void {
		const parser = this.assembler.parser;

		if (!parser.isIdentifier()) {
			this.assembler.symbolTable.setNamespace("global");
			return;
		}

		const ns = parser.identifier().value;

		const metadata: Record<string, SymbolValue> = {};
		while (parser.isIdentifier() && parser.peek()?.line === directive.line) {
			const key = parser.identifier().value;

			parser.operator("=");

			const exprTokens = parser.getExpressionTokens(directive);
			metadata[key] = this.assembler.expressionEvaluator.evaluate(exprTokens, context);

			if (parser.is("COMMA")) parser.advance();
			else break;
		}

		if (!parser.isEOS() && parser.peek()?.line === directive.line) throw new Error(`SYNTAXERROR on line ${directive.line}: Unexpected token.`);

		this.assembler.symbolTable.pushNamespace(ns, metadata);
	}
}
