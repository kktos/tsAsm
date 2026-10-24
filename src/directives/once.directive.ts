import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

/** `.once`: the file it is in is assembled only once, however many times it is included (like C's `#pragma once`). */
export class OnceDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly assembler: Assembler) {}

	public handlePassOne(directive: ScalarToken, _context: DirectiveContext) {
		this.handle(directive);
	}

	public handlePassTwo(directive: ScalarToken, _context: DirectiveContext) {
		this.handle(directive);
	}

	private handle(directive: ScalarToken) {
		const tokens = this.assembler.parser.getInstructionTokens(directive);
		if (tokens.length > 0) throw new Error(".ONCE takes no argument.");
		this.assembler.streamManager.markOnce();
	}
}
