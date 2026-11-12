import type { Assembler } from "../assembler/polyasm";
import type { SymbolValue } from "../assembler/symbol.class";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { hasNoMoreThanOne } from "../utils/array.utils";
import type { DirectiveContext, IDirective } from "./directive.interface";
import { checkInstance, readStructType } from "./struct.directive";

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
		const parser = this.assembler.parser;
		const lineTokens = parser.getExpressionTokens(directive);
		// The expression ends before `as`, an identifier after its value: `.let p = $80 as Sprite`.
		const as = parser.peek();
		if (as?.type === "IDENTIFIER" && as.value === "AS" && as.line === directive.line) lineTokens.push(...parser.getInstructionTokens(directive));
		if (!hasNoMoreThanOne<Token>(lineTokens, (token: Token) => token.type === "OPERATOR" && token.value === "="))
			throw new Error('.LET expression only allows operator "==" to test equality.');

		const index = lineTokens.findIndex((token) => token.type === "OPERATOR" && token.value === "=");

		let name: SymbolValue = "";
		const nameTokens = lineTokens.slice(0, index);
		if (nameTokens.length === 1 && nameTokens[0]?.type === "IDENTIFIER") name = nameTokens[0].value;
		else name = this.assembler.expressionEvaluator.evaluate(nameTokens, context);
		if (typeof name !== "string") throw new Error("Expected a string for symbol name.");

		const parts = name.split("::");
		parts.forEach((part) => {
			if (!this.assembler.parser.lexer.isValidIdentifier(part)) throw new Error(`Invalid identifier for symbol name: ${name}.`);
		});

		const { valueTokens, struct } = readStructType(lineTokens.slice(index + 1), this.assembler.expressionEvaluator, context, parser.peek());
		const value = this.assembler.expressionEvaluator.evaluate(valueTokens, context);
		if (struct) checkInstance(value, struct, valueTokens[0] as Token);

		this.lister.symbol(name, value);

		const nameToken = nameTokens[0] ?? directive;
		const symbolTable = this.assembler.symbolTable;
		// Out of a macro call to the scope around it, but a function's variables stay in its call.
		const isLocal = symbolTable.isFunctionScope();
		if (isLocal && name.includes("::")) throw new Error(`A function's variables are its own: it can't assign '${name}'.`);
		if (this.assembler.pass === 1 || (isLocal && !symbolTable.hasSymbolInScope(name)))
			symbolTable.defineVariable(name, value, { filename: context.filename, line: nameToken.line, column: nameToken.column }, !isLocal);
		else symbolTable.updateSymbol(name, value, !isLocal);
		symbolTable.setStruct(name, struct);
		// A name built by an expression isn't written: only `.let x = 1` is a reference to `x`.
		if (nameTokens.length === 1 && nameTokens[0]?.type === "IDENTIFIER") this.assembler.reportAssignment(nameTokens[0], name);
	}
}
