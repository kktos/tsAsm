import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";

export class EndianDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassTwo(_directive: ScalarToken, _context: DirectiveContext) {
		const endianess = this.runtime.parser.identifier(["BIG", "LITTLE"]).value;
		this.runtime.linker.setEndianess(endianess.toLowerCase() as "little" | "big");
	}

	public handlePassOne(_directive: ScalarToken, _context: DirectiveContext) {}
}
