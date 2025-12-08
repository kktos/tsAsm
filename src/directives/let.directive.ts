import type { ScalarToken, Token } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { StreamState } from "../polyasm.types";
import type { SymbolValue } from "../symbol.class";
import { hasNoMoreThanOne } from "../utils/array.utils";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class LetDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		this.handleLet(directive, assembler);
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		this.handleLet(directive, assembler);
	}

	private handleLet(directive: ScalarToken, assembler: Assembler) {
		const lineTokens = assembler.parser.getExpressionTokens(directive);
		if (!hasNoMoreThanOne<Token>(lineTokens, (token: Token) => token.type === "OPERATOR" && token.value === "="))
			throw `.LET expression only allows operator "==" to test equality`;

		const index = lineTokens.findIndex((token) => token.type === "OPERATOR" && token.value === "=");

		let name: SymbolValue = "";
		const nameTokens = lineTokens.slice(0, index);
		if (nameTokens.length === 1 && nameTokens[0]?.type === "IDENTIFIER") name = nameTokens[0].value;
		else
			name = assembler.expressionEvaluator.evaluate(nameTokens, {
				pc: assembler.currentPC,
				allowForwardRef: assembler.pass === 1,
				currentGlobalLabel: assembler.lastGlobalLabel,
				macroArgs: (assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
			});
		if (typeof name !== "string") throw "Expected a string for symbol name";

		if (!assembler.lexer.isValidIdentifier(name)) throw `Invalid identifier for symbol name : ${name}`;

		const expressionTokens = lineTokens.slice(index + 1);
		const value = assembler.expressionEvaluator.evaluate(expressionTokens, {
			pc: assembler.currentPC,
			allowForwardRef: assembler.pass === 1,
			currentGlobalLabel: assembler.lastGlobalLabel,
			macroArgs: (assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
		});

		assembler.lister.symbol(name, value);

		if (assembler.pass === 1) assembler.symbolTable.assignVariable(name, value);
		else assembler.symbolTable.updateSymbol(name, value);
	}
}
