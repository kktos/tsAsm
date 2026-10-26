import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export class IncludeDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly runtime: DirectiveRuntime,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.assembler.parser.getInstructionTokens();

		if (expressionTokens.length === 0) throw new Error(".INCLUDE requires a string argument.");

		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(".INCLUDE requires a string argument.");

		try {
			const logConfigDepth = this.assembler.logger.getConfigDepth();

			if (!this.assembler.streamManager.startNewStream(filename, true, this.runtime.includeSites(this.assembler.currentStatement ?? directive))) return;
			this.assembler.parser.pushTokenStream({
				newTokens: this.assembler.parser.lexer.getBufferedTokens(),
				file: this.assembler.streamManager.currentFilepath,
				onEndOfStream: () => {
					// cleanup the log config if a .LIST file was included
					if (logConfigDepth < this.assembler.logger.getConfigDepth()) this.assembler.logger.popConfig();
					this.assembler.streamManager.endCurrentStream();
				},
			});

			this.runtime.lister.directive(directive, this.assembler.streamManager.currentFilepath);
		} catch (e) {
			throw new Error(`Can't include '${filename}': ${e instanceof Error ? e.message : e}`);
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.assembler.parser.getInstructionTokens();
		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(".INCLUDE requires a string argument.");

		const logConfigDepth = this.assembler.logger.getConfigDepth();
		if (!this.assembler.streamManager.startNewStream(filename, false, this.runtime.includeSites(this.assembler.currentStatement ?? directive))) return;
		this.assembler.parser.pushTokenStream({
			file: this.assembler.streamManager.currentFilepath,
			newTokens: [],
			onEndOfStream: () => {
				// cleanup the log config if a .LIST file was included
				if (logConfigDepth < this.assembler.logger.getConfigDepth()) this.assembler.logger.popConfig();
				this.assembler.streamManager.endCurrentStream();
			},
		});

		this.runtime.lister.directive(directive, this.assembler.streamManager.currentFilepath);
	}
}
