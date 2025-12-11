import type { Assembler } from "../assembler/polyasm";
import type { StreamState } from "../assembler/polyasm.types";
import type { Lister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class EquDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: Lister,
	) {}

	public handlePassOne(directive: ScalarToken, _context: DirectiveContext): void {
		const labelToken = this.assembler.parser.ensureToken(this.assembler.parser.getPosition() - 3);

		if (!labelToken || labelToken.type !== "IDENTIFIER" || labelToken.line !== directive.line)
			throw new Error(`Syntax error in line ${directive.line} - Missing symbol name before .EQU`);

		const label = this.assembler.lastGlobalLabel;
		if (!label) throw new Error(`Syntax error in line ${directive.line} - Missing symbol name before .EQU`);

		this.assembler.lastGlobalLabel = null;

		const expressionTokens = this.assembler.parser.getInstructionTokens();

		const value = this.assembler.expressionEvaluator.evaluate(expressionTokens, {
			pc: this.assembler.currentPC,
			allowForwardRef: true,
			currentGlobalLabel: label,
			macroArgs: (this.assembler.parser.tokenStreamStack[this.assembler.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
		});

		this.lister.symbol(label, value);

		this.assembler.symbolTable.defineConstant(label, value);
	}

	public handlePassTwo(directive: ScalarToken, _context: DirectiveContext): void {
		const label = this.assembler.lastGlobalLabel;
		if (!label) throw new Error(`Syntax error in line ${directive.line} - Missing label name`);

		const expressionTokens = this.assembler.parser.getInstructionTokens(directive);

		const value = this.assembler.expressionEvaluator.evaluate(expressionTokens, {
			pc: this.assembler.currentPC,
			allowForwardRef: false, // now require resolution
			currentGlobalLabel: this.assembler.lastGlobalLabel,
			macroArgs: (this.assembler.parser.tokenStreamStack[this.assembler.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
		});

		// If evaluation produced undefined, treat as an error in Pass 2
		if (value === undefined) throw new Error(`line ${directive.line}: Unresolved assignment for ${label}`);

		this.lister.symbol(label, value);

		this.assembler.symbolTable.updateSymbol(label, value);
	}
}
