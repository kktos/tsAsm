import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

/**
 * `.return <expression>`: ends the call of the block function it's in, which gives the value. What's left of the body
 * isn't run, but checked as a branch not taken.
 */
export class ReturnDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		this.return(directive, context);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		this.return(directive, context);
	}

	private return(directive: ScalarToken, context: DirectiveContext) {
		const parser = this.runtime.parser;
		const streams = parser.tokenStreamStack;

		// The innermost function's body, unless a macro body or an included file comes first: it has its own text.
		const callAt = streams.findLastIndex((stream) => stream.functionCall || stream.macroName !== undefined || stream.file !== undefined);
		const functionCall = streams[callAt]?.functionCall;
		if (!functionCall) throw new Error(`Unexpected directive '.${directive.value}': it isn't in a function.`);

		const value = this.runtime.evaluator.evaluate(parser.getInstructionTokens(directive), context);
		functionCall.result = { value };
		parser.exitTokenStreams(directive, callAt);
	}
}
