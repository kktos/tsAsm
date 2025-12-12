import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export class IfDirective implements IDirective {
	isBlockDirective = true;
	isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	private work(directive: ScalarToken, context: DirectiveContext): void {
		const parser = this.runtime.parser;

		// 1. Get and evaluate the IF expression.
		const ifExprTokens = parser.getInstructionTokens(directive);
		const ifResult = this.runtime.evaluator.evaluate(ifExprTokens, context);

		let activeBranchFound = false;
		let tokensToPush: Token[] = [];

		// --- Process IF branch ---
		if (ifResult) {
			activeBranchFound = true;
			tokensToPush = parser.getDirectiveBlockTokens(directive.value, ["ELSE"]);
		} else {
			parser.getDirectiveBlockTokens(directive.value, ["ELSE"]);
		}

		// --- Check for and process ELSE branch ---

		let nextIsElse = false;
		const terminatorToken = parser.peek(-1);
		const dotToken = parser.peek(-2);

		if (terminatorToken?.type === "RBRACE") {
			// After a C-style block, we might have an optional .ELSE
			if (parser.is("DOT") && parser.is("IDENTIFIER", "ELSE", 1)) {
				nextIsElse = true;
			}
		} else if (dotToken?.type === "DOT" && terminatorToken?.type === "IDENTIFIER" && terminatorToken.value === "ELSE") {
			// An Asm-style block was terminated by .ELSE
			nextIsElse = true;
		}

		if (nextIsElse) {
			// If the terminator was a brace, we need to consume the .ELSE we peeked at
			if (terminatorToken?.type === "RBRACE") parser.advance(2);

			if (!activeBranchFound) {
				activeBranchFound = true;
				tokensToPush = parser.getDirectiveBlockTokens("ELSE");
			} else {
				parser.getDirectiveBlockTokens("ELSE");
			}
		}

		// --- Push the collected tokens for the active branch ---
		if (tokensToPush.length > 0) parser.pushTokenStream({ newTokens: tokensToPush, macroArgs: context.macroArgs });
	}

	handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		this.work(directive, context);
	}
	handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		this.work(directive, context);
	}
}
