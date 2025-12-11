import type { Assembler } from "../assembler/polyasm";
import type { StreamState } from "../assembler/polyasm.types";
import type { ScalarToken } from "../lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class EquDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		const labelToken = assembler.parser.ensureToken(assembler.parser.getPosition() - 3);

		if (!labelToken || labelToken.type !== "IDENTIFIER" || labelToken.line !== directive.line)
			throw new Error(`Syntax error in line ${directive.line} - Missing symbol name before .EQU`);

		const label = assembler.lastGlobalLabel;
		if (!label) throw new Error(`Syntax error in line ${directive.line} - Missing symbol name before .EQU`);

		assembler.lastGlobalLabel = null;

		const expressionTokens = assembler.parser.getInstructionTokens();

		const value = assembler.expressionEvaluator.evaluate(expressionTokens, {
			pc: assembler.currentPC,
			allowForwardRef: true,
			currentGlobalLabel: label,
			macroArgs: (assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
		});

		assembler.lister.symbol(label, value);

		assembler.symbolTable.defineConstant(label, value);
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		const label = assembler.lastGlobalLabel;
		if (!label) throw new Error(`Syntax error in line ${directive.line} - Missing label name`);

		const expressionTokens = assembler.parser.getInstructionTokens(directive);

		const value = assembler.expressionEvaluator.evaluate(expressionTokens, {
			pc: assembler.currentPC,
			allowForwardRef: false, // now require resolution
			currentGlobalLabel: assembler.lastGlobalLabel,
			macroArgs: (assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
			assembler,
		});

		// If evaluation produced undefined, treat as an error in Pass 2
		if (value === undefined) throw new Error(`line ${directive.line}: Unresolved assignment for ${label}`);

		assembler.lister.symbol(label, value);

		assembler.symbolTable.updateSymbol(label, value);
	}
}
