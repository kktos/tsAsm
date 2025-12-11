import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class IncludeDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		// Find expression tokens on the header line after 'OF', optionally followed by 'AS'
		const expressionTokens = assembler.parser.getInstructionTokens();
		// let asIndex = exprHeader.findIndex((t) => t.type === "IDENTIFIER" && t.value === "AS");
		// if (asIndex === -1) asIndex = exprHeader.length;
		// const expressionTokens = exprHeader.slice(0, asIndex);
		// const indexIteratorToken = asIndex < exprHeader.length ? (exprHeader[asIndex + 1] as IdentifierToken) : undefined;

		if (expressionTokens.length === 0) throw new Error(`.INCLUDE requires a string argument on line ${directive.line}.`);

		// 2. Resolve the array from the symbol table
		const evaluationContext = {
			pc: assembler.currentPC,
			macroArgs: assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1]?.macroArgs,
			assembler,
			currentGlobalLabel: assembler.lastGlobalLabel ?? undefined,
		};

		const filename = assembler.expressionEvaluator.evaluate(expressionTokens, evaluationContext);
		if (typeof filename !== "string") throw new Error(`.INCLUDE requires a string argument on line ${directive.line}.`);

		try {
			assembler.startNewStream(filename);
			assembler.parser.pushTokenStream({
				newTokens: assembler.parser.lexer.getBufferedTokens(),
				cacheName: assembler.fileHandler.fullpath,
				onEndOfStream: () => {
					assembler.endCurrentStream();
					// assembler.lister.directive({ ...directive, value: "END INCLUDE" }, filename);
				},
			});

			assembler.lister.directive(directive, assembler.fileHandler.fullpath);
		} catch (e) {
			throw `including file ${filename} on line ${directive.line}: ${e}`;
		}
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		const expressionTokens = assembler.parser.getInstructionTokens();

		const evaluationContext = {
			pc: assembler.currentPC,
			macroArgs: assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1]?.macroArgs,
			assembler,
			currentGlobalLabel: assembler.lastGlobalLabel ?? undefined,
		};
		const filename = assembler.expressionEvaluator.evaluate(expressionTokens, evaluationContext);
		if (typeof filename !== "string") throw new Error(`.INCLUDE requires a string argument on line ${directive.line}.`);

		assembler.startNewStream(filename);
		assembler.parser.pushTokenStream({
			cacheName: assembler.currentFilename,
			newTokens: [],
			onEndOfStream: () => {
				assembler.endCurrentStream();
				// 	assembler.lister.directive({ ...directive, value: "END INCLUDE" }, filename);
			},
		});

		assembler.lister.directive(directive, assembler.fileHandler.fullpath);
	}
}
