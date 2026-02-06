import type { Assembler } from "../assembler/polyasm";
import type { SymbolValue } from "../assembler/symbol.class";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { hasNoMoreThanOne } from "../utils/array.utils";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class LetDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: ILister,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		this.handleLet(directive, context);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		this.handleLet(directive, context);
	}

	private handleLet(directive: ScalarToken, context: DirectiveContext) {
		const lineTokens = this.assembler.parser.getExpressionTokens(directive);
		if (!hasNoMoreThanOne<Token>(lineTokens, (token: Token) => token.type === "OPERATOR" && token.value === "="))
			throw `.LET expression only allows operator "==" to test equality`;

		const index = lineTokens.findIndex((token) => token.type === "OPERATOR" && token.value === "=");

		let name: SymbolValue = "";
		const nameTokens = lineTokens.slice(0, index);
		if (nameTokens.length === 1 && nameTokens[0]?.type === "IDENTIFIER") name = nameTokens[0].value;
		else name = this.assembler.expressionEvaluator.evaluate(nameTokens, context);
		if (typeof name !== "string") throw "Expected a string for symbol name";

		// const parts = name.split("::");
		// parts.forEach((part) => {
		// 	if (!this.assembler.parser.lexer.isValidIdentifier(part)) throw `Invalid identifier for symbol name : ${name}`;
		// });

		const expressionTokens = lineTokens.slice(index + 1);
		const value = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);

		this.lister.symbol(name, value);

		if (this.assembler.pass === 1) this.assembler.symbolTable.assignVariable(name, value, true);
		else this.assembler.symbolTable.updateSymbol(name, value, true);
	}
}
