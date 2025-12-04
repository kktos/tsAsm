import type { ScalarToken } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class IncludeDirective implements IDirective {
	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		// Find expression tokens on the header line after 'OF', optionally followed by 'AS'
		const expressionTokens = assembler.parser.getInstructionTokens();
		// let asIndex = exprHeader.findIndex((t) => t.type === "IDENTIFIER" && t.value === "AS");
		// if (asIndex === -1) asIndex = exprHeader.length;
		// const expressionTokens = exprHeader.slice(0, asIndex);
		// const indexIteratorToken = asIndex < exprHeader.length ? (exprHeader[asIndex + 1] as IdentifierToken) : undefined;

		if (expressionTokens.length === 0) throw new Error(`ERROR: .INCLUDE requires a string argument on line ${directive.line}.`);

		// 2. Resolve the array from the symbol table
		const evaluationContext = {
			pc: assembler.currentPC,
			macroArgs: assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1]?.macroArgs,
			assembler,
			currentGlobalLabel: assembler.getLastGlobalLabel?.() ?? undefined,
		};

		const filename = assembler.expressionEvaluator.evaluate(expressionTokens, evaluationContext);
		if (typeof filename !== "string") throw new Error(`ERROR: .INCLUDE requires a string argument on line ${directive.line}.`);

		try {
			assembler.startNewStream(filename);
			assembler.parser.pushTokenStream({ newTokens: assembler.lexer.getBufferedTokens(), cacheName: filename });

			assembler.lister.directive(directive, filename);
		} catch (e) {
			throw `ERROR including file ${filename} on line ${directive.line}: ${e}`;
		}
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		const expressionTokens = assembler.parser.getInstructionTokens();

		const evaluationContext = {
			pc: assembler.currentPC,
			macroArgs: assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1]?.macroArgs,
			assembler,
			currentGlobalLabel: assembler.getLastGlobalLabel?.() ?? undefined,
		};
		const filename = assembler.expressionEvaluator.evaluate(expressionTokens, evaluationContext);
		if (typeof filename !== "string") throw new Error(`ERROR: .INCLUDE requires a string argument on line ${directive.line}.`);

		assembler.parser.pushTokenStream({ cacheName: filename, newTokens: [] });
	}
}
