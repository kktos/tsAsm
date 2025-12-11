import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class EndDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly assembler: Assembler) {}

	public handlePassOne(directive: ScalarToken, _context: DirectiveContext): void {
		const tokens = this.assembler.parser.getInstructionTokens(directive);

		if (tokens.length === 1 && tokens[0]?.value === "NAMESPACE") {
			this.assembler.symbolTable.popNamespace();
			return;
		}

		throw new Error(`line ${directive.line}: Unexpected directive '${directive.value}'`);
	}

	public handlePassTwo(directive: ScalarToken, _context: DirectiveContext): void {
		this.assembler.parser.getInstructionTokens(directive);
		this.assembler.symbolTable.popNamespace();
	}
}
