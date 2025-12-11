import type { Assembler } from "../assembler/polyasm";
import type { Lister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class IncludeDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: Lister,
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
			this.assembler.startNewStream(filename);
			this.assembler.parser.pushTokenStream({
				newTokens: this.assembler.parser.lexer.getBufferedTokens(),
				cacheName: this.assembler.fileHandler.fullpath,
				onEndOfStream: () => {
					this.assembler.endCurrentStream();
					// this.assembler.lister.directive({ ...directive, value: "END INCLUDE" }, filename);
				},
			});

			this.lister.directive(directive, this.assembler.fileHandler.fullpath);
		} catch (e) {
			throw `including file ${filename} on line ${directive.line}: ${e}`;
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.assembler.parser.getInstructionTokens();
		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(`.INCLUDE requires a string argument on line ${directive.line}.`);

		this.assembler.startNewStream(filename);
		this.assembler.parser.pushTokenStream({
			cacheName: this.assembler.currentFilename,
			newTokens: [],
			onEndOfStream: () => {
				this.assembler.endCurrentStream();
				// 	this.assembler.lister.directive({ ...directive, value: "END INCLUDE" }, filename);
			},
		});

		this.lister.directive(directive, this.assembler.fileHandler.fullpath);
	}
}
