import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";

export class LinkerIncludeDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(_directive: ScalarToken, _context: DirectiveContext) {}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.runtime.parser.getInstructionTokens();
		const filename = this.runtime.evaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(`.INCLUDE requires a string argument on line ${directive.line}.`);

		if (!this.runtime.linker.streamManager) {
			throw new Error(".INCLUDE is not supported in this linker context (no file handler).");
		}
		const streamManager = this.runtime.linker.streamManager;

		streamManager.startNewStream(filename);

		this.runtime.parser.pushTokenStream({
			cacheName: streamManager.currentFilepath,
			newTokens: this.runtime.parser.lexer.getBufferedTokens(), // linker runs in one pass, so we need tokens
			onEndOfStream: () => {
				streamManager.endCurrentStream();
			},
		});

		this.runtime.lister.directive(directive, streamManager.currentFilepath);
	}
}
