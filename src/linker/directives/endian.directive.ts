import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";
import type { Linker } from "../linker.class";

export class EndianDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly runtime: DirectiveRuntime,
		private linker: Linker,
	) {}

	public handlePassOne(_directive: ScalarToken, _context: DirectiveContext) {
		const endianess = this.runtime.parser.identifier(["BIG", "LITTLE"]).value;
		this.linker.setEndianess(endianess.toLowerCase() as "little" | "big");
	}

	public handlePassTwo(_directive: ScalarToken, _context: DirectiveContext) {}
}
