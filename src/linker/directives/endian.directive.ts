import type { Assembler } from "../../assembler/polyasm";
import type { DirectiveContext, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";
import type { Linker } from "../linker.class";

export class EndianDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private linker: Linker) {}

	public handlePassOne(_directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		const endianess = assembler.parser.identifier(["BIG", "LITTLE"]).value;
		this.linker.setEndianess(endianess.toLowerCase() as "little" | "big");
	}

	public handlePassTwo(_directive: ScalarToken, _assembler: Assembler, _context: DirectiveContext) {}
}
