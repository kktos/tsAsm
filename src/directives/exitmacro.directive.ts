import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveRuntime, IDirective } from "./directive.interface";

/**
 * `.exitmacro`: ends the expansion of the macro it's in, and what it's in within that macro (an `.if` branch, a loop,
 * all its iterations). What's left isn't assembled, but checked as a branch not taken.
 */
export class ExitMacroDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken) {
		this.exit(directive);
	}

	public handlePassTwo(directive: ScalarToken) {
		this.exit(directive);
	}

	private exit(directive: ScalarToken) {
		const parser = this.runtime.parser;
		const streams = parser.tokenStreamStack;

		// The innermost macro body, unless an included file comes first: the file isn't the macro's text.
		const macroAt = streams.findLastIndex((stream) => stream.macroName !== undefined || stream.file !== undefined);
		if (macroAt === -1 || streams[macroAt]?.macroName === undefined) throw new Error(`Unexpected directive '.${directive.value}': it isn't in a macro.`);

		parser.exitTokenStreams(directive, macroAt);
	}
}
