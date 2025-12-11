import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class EndDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		const tokens = assembler.parser.getInstructionTokens(directive);

		if (tokens.length === 1 && tokens[0]?.value === "NAMESPACE") {
			assembler.symbolTable.popNamespace();
			return;
		}

		throw new Error(`line ${directive.line}: Unexpected directive '${directive.value}'`);
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		assembler.parser.getInstructionTokens(directive);
		assembler.symbolTable.popNamespace();
	}
}
