import type { Assembler } from "../assembler/polyasm";
import type { IdentifierToken, ScalarToken } from "../shared/lexer/lexer.class";
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

	private setNamespace(directive: ScalarToken, _context: DirectiveContext): void {
		const tokens = this.assembler.parser.getInstructionTokens(directive);
		// If no argument provided, reset to GLOBAL namespace (behave like `.NAMESPACE GLOBAL`)
		if (tokens.length === 0) {
			this.assembler.symbolTable.setNamespace("global");
			return;
		}

		const token = tokens[0] as IdentifierToken;
		if (token.type !== "IDENTIFIER") throw `ERROR on line ${directive.line}: .NAMESPACE directive requires an identifier.`;

		const ns = token.value;
		this.assembler.symbolTable.pushNamespace(ns);
	}
}
