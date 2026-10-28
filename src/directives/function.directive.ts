import type { Parser } from "../assembler/parser.class";
import { UserFunction } from "../assembler/user-function.class";
import { tokensText } from "../helpers/lister.class";
import type { IdentifierToken, ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

/** `.function name(` and `name(`: the `(` glued to the name, as for a call. */
const isFunctionName = (name: Token | null | undefined, next: Token | null | undefined) =>
	name?.type === "IDENTIFIER" &&
	next?.type === "OPERATOR" &&
	next.value === "(" &&
	next.line === name.line &&
	next.column === name.column + String(name.raw ?? name.value).length;

/**
 * `.function name(params) = expression` (`.fn`): a user function, called as `name(…)` in an expression.
 * Without the parentheses, it's the old routine scope, now `.proc`: an error that says so.
 */
export class FunctionDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = true;

	constructor(private readonly runtime: DirectiveRuntime) {}

	/** In a block: a function is its line; the old routine scope is closed by its `.end`, which isn't the block's. */
	getRawBlock(parser: Parser, directive: Token): Token[] {
		const lineTokens = parser.getInstructionTokens(directive);
		if (isFunctionName(lineTokens[0], lineTokens[1])) return lineTokens;
		return [...lineTokens, ...parser.getDirectiveBlockTokens("FUNCTION")];
	}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const fn = this.readFunction(directive, context);
		this.runtime.symbolTable.defineConstant(fn.name, fn, { filename: context.filename, line: directive.line, column: directive.column });
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const fn = this.readFunction(directive, context);
		this.runtime.symbolTable.updateSymbol(fn.name, fn);
	}

	private readFunction(directive: ScalarToken, context: DirectiveContext): UserFunction {
		const { parser } = this.runtime;
		const nameToken = parser.peek();
		if (nameToken?.line !== directive.line || !isFunctionName(nameToken, parser.peek(1))) this.reject(directive);

		const tokens = parser.getInstructionTokens(directive);
		const name = String(nameToken.raw ?? nameToken.value);
		const { parameters, closeIndex } = this.readParameters(name, tokens);
		const assign = tokens[closeIndex + 1];
		if (assign?.type !== "OPERATOR" || assign.value !== "=") {
			if (!assign && parser.peek()?.type === "LBRACE")
				throw AsmError.at(`A function's body is one expression for now: write .${directive.value} ${name}(…) = <expression>.`, parser.peek() as Token);
			throw AsmError.at(`Missing '=' and the expression of function '${name}'.`, assign ?? (tokens[closeIndex] as Token));
		}
		const body = tokens.slice(closeIndex + 2);
		if (body.length === 0) throw AsmError.at(`Missing the expression of function '${name}' after '='.`, assign);

		this.runtime.lister.directive(
			directive,
			`${name}(${parameters.map((parameter) => parameter.raw ?? parameter.value).join(", ")}) = ${tokensText(body)}`,
		);

		const statement = this.runtime.currentStatement() ?? directive;
		const site = this.runtime.definitionSite(statement);
		site.location.file ??= context.filename;
		return new UserFunction(name, parameters, body, this.runtime.symbolTable.captureScopes(), site);
	}

	/** The names between the parentheses, `tokens` starting with the function's name, and where the `)` is. */
	private readParameters(name: string, tokens: Token[]): { parameters: IdentifierToken[]; closeIndex: number } {
		const parameters: IdentifierToken[] = [];
		let index = 2;
		if (tokens[index]?.type === "OPERATOR" && tokens[index]?.value === ")") return { parameters, closeIndex: index };

		while (true) {
			const parameter = tokens[index];
			if (parameter?.type !== "IDENTIFIER")
				throw AsmError.at(`A parameter of function '${name}' must be a name.`, parameter ?? (tokens[index - 1] as Token));
			if (parameters.some((other) => other.value === parameter.value))
				throw AsmError.at(`Parameter '${parameter.raw ?? parameter.value}' of function '${name}' is given twice.`, parameter);
			parameters.push(parameter as IdentifierToken);

			const separator = tokens[index + 1];
			if (separator?.type === "OPERATOR" && separator.value === ")") return { parameters, closeIndex: index + 1 };
			if (separator?.type !== "COMMA") throw AsmError.at(`Missing ')' after the parameters of function '${name}'.`, separator ?? parameter);
			index += 2;
		}
	}

	private reject(directive: ScalarToken): never {
		const token = this.runtime.parser.peek();
		const name = token?.type === "IDENTIFIER" && token.line === directive.line ? ` ${token.raw ?? token.value}` : "";
		throw AsmError.at(
			`.${directive.value} is no longer a routine scope: write .proc${name}. A function has parentheses: .${directive.value}${name || " name"}(…) = <expression>.`,
			directive,
		);
	}
}
