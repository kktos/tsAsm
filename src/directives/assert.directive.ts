import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";
import { formatValue } from "./log.directive";

/** The kind of a failed assertion, its second argument when given: the names of `.warning` and `.error`. */
const KINDS: Record<string, "WARN" | "ERR"> = { WARN: "WARN", WARNING: "WARN", ERR: "ERR", ERROR: "ERR" };

/** `.assert <condition> [, warn | err] [, <value> …]`: a false condition stops the assembly, or only warns. */
export class AssertDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	// The condition is checked once, in pass 2, when all symbols are known: pass 1 only skips its line.
	public handlePassOne(directive: ScalarToken) {
		this.runtime.parser.getInstructionTokens(directive);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const [condition, second, ...others] = this.readArguments(directive);
		const kind = second && this.kindOf(second);
		const message = kind ? others : second ? [second, ...others] : [];

		if (this.runtime.evaluator.evaluate(condition as Token[], context)) return;

		const text = message.length ? message.map((tokens) => formatValue(this.runtime.evaluator.evaluate(tokens, context))).join("\t") : "Assertion failed";
		if (kind === "WARN") this.runtime.warn(text);
		else throw new Error(text);
	}

	/** `warn` or `err` (any case), a word of its own: `warn + 1` or a string is a message. */
	private kindOf(tokens: Token[]) {
		const token = tokens[0] as Token;
		if (tokens.length !== 1 || token.type !== "IDENTIFIER") return undefined;
		return KINDS[String(token.value).toUpperCase()];
	}

	/** The comma-separated arguments, the condition first: none may be empty, and nothing may follow the last one. */
	private readArguments(directive: ScalarToken): Token[][] {
		const parser = this.runtime.parser;
		const args: Token[][] = [];
		let before: Token = directive;
		while (true) {
			// getExpressionTokens takes the first token whatever it is: a comma there is an empty argument.
			const tokens = parser.is("COMMA") ? [] : parser.getExpressionTokens(directive);
			if (!tokens.length) throw AsmError.at("Missing expression.", before);
			args.push(tokens);

			const next = parser.peek();
			if (!next || next.line !== directive.line || ["EOF", "LBRACE", "RBRACE"].includes(next.type)) return args;
			if (next.type !== "COMMA") throw AsmError.at(`Unexpected '${next.value}' after the expression.`, next);
			before = next;
			parser.advance();
		}
	}
}
