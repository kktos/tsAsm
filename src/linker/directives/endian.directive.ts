import type { Parser } from "../../assembler/parser.class";
import type { DirectiveContext, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";
import type { Linker } from "../linker.class";

export class EndianDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly parser: Parser,
		private linker: Linker,
	) {}

	public handlePassOne(_directive: ScalarToken, _context: DirectiveContext) {
		const endianess = this.parser.identifier(["BIG", "LITTLE"]).value;
		this.linker.setEndianess(endianess.toLowerCase() as "little" | "big");
	}

	public handlePassTwo(_directive: ScalarToken, _context: DirectiveContext) {}
}
