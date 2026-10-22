import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export class EndDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, _context: DirectiveContext): void {
		const tokens = this.runtime.parser.getInstructionTokens(directive);

		if (tokens.length === 1 && tokens[0]?.value === "NAMESPACE") {
			this.runtime.symbolTable.popNamespace();
			return;
		}

		throw new Error(`Unexpected directive '.${directive.value}': there's no block to end.`);
	}

	public handlePassTwo(directive: ScalarToken, _context: DirectiveContext): void {
		this.runtime.parser.getInstructionTokens(directive);
		this.runtime.symbolTable.popNamespace();
	}
}
