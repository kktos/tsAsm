import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveRuntime, IDirective } from "./directive.interface";

/**
 * `.break`: ends the innermost loop it's in, with its iterations left, and what it's in within that loop (an `.if`
 * branch, an inner block). What's left isn't assembled, but checked as a branch not taken.
 */
export class BreakDirective implements IDirective {
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

		// The innermost loop's iteration, unless a macro body or an included file comes first: it has its own text.
		const loopAt = streams.findLastIndex((stream) => stream.loop || stream.macroName !== undefined || stream.file !== undefined);
		const stream = streams[loopAt];
		if (!stream?.loop) {
			const where = stream?.macroName !== undefined ? ` of the macro '${stream.macroName}'` : stream?.file !== undefined ? " of the included file" : "";
			throw new Error(`Unexpected directive '.${directive.value}': it isn't in a loop${where}.`);
		}

		parser.exitTokenStreams(directive, loopAt);
	}
}
