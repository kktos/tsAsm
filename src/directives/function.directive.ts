import type { Parser } from "../assembler/parser.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import type { DirectiveContext, IDirective } from "./directive.interface";

/**
 * `.function` / `.fn` were a routine scope, now `.proc`: they are an error until they define user functions (TODO 4.8).
 * Still a block directive, so that its `.end` closes it in a block that isn't assembled.
 */
export class FunctionDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	constructor(private readonly parser: Parser) {}

	private reject(directive: ScalarToken): never {
		const token = this.parser.peek();
		const name = token?.type === "IDENTIFIER" && token.line === directive.line ? ` ${token.raw ?? token.value}` : "";
		throw AsmError.at(`.${directive.value} is no longer a routine scope: write .proc${name}.`, directive);
	}

	public handlePassOne(directive: ScalarToken, _context: DirectiveContext): void {
		this.reject(directive);
	}

	public handlePassTwo(directive: ScalarToken, _context: DirectiveContext): void {
		this.reject(directive);
	}
}
