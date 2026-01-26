import type { Assembler } from "../assembler/polyasm";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class IncludeDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: ILister,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		// Find expression tokens on the header line after 'OF', optionally followed by 'AS'
		const expressionTokens = this.assembler.parser.getInstructionTokens();
		// let asIndex = exprHeader.findIndex((t) => t.type === "IDENTIFIER" && t.value === "AS");
		// if (asIndex === -1) asIndex = exprHeader.length;
		// const expressionTokens = exprHeader.slice(0, asIndex);
		// const indexIteratorToken = asIndex < exprHeader.length ? (exprHeader[asIndex + 1] as IdentifierToken) : undefined;

		if (expressionTokens.length === 0) throw new Error(`.INCLUDE requires a string argument on line ${directive.line}.`);

		// 2. Resolve the array from the symbol table
		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(`.INCLUDE requires a string argument on line ${directive.line}.`);

		try {
			const logConfigDepth = this.assembler.logger.getConfigDepth();

			// console.log("INCLUDE", logConfigDepth, filename);

			this.assembler.streamManager.startNewStream(filename);
			this.assembler.parser.pushTokenStream({
				newTokens: this.assembler.parser.lexer.getBufferedTokens(),
				cacheName: this.assembler.streamManager.currentFilepath,
				onEndOfStream: () => {
					// console.log("END", this.assembler.logger.getConfigDepth(), logConfigDepth, this.assembler.fileHandler.fullpath);

					// cleanup the log config if a .LIST file was included
					if (logConfigDepth < this.assembler.logger.getConfigDepth()) this.assembler.logger.popConfig();
					this.assembler.streamManager.endCurrentStream();
				},
			});

			this.lister.directive(directive, this.assembler.streamManager.currentFilepath);
		} catch (e) {
			throw `including file ${filename} on line ${directive.line}: ${e}`;
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.assembler.parser.getInstructionTokens();
		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(`.INCLUDE requires a string argument on line ${directive.line}.`);

		const logConfigDepth = this.assembler.logger.getConfigDepth();
		this.assembler.streamManager.startNewStream(filename, false);
		this.assembler.parser.pushTokenStream({
			cacheName: this.assembler.streamManager.currentFilepath,
			newTokens: [],
			onEndOfStream: () => {
				// cleanup the log config if a .LIST file was included
				if (logConfigDepth < this.assembler.logger.getConfigDepth()) this.assembler.logger.popConfig();
				this.assembler.streamManager.endCurrentStream();
			},
		});

		this.lister.directive(directive, this.assembler.streamManager.currentFilepath);
	}
}
