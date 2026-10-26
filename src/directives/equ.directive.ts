import type { Assembler } from "../assembler/polyasm";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class EquDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: ILister,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const labelToken = this.assembler.parser.ensureToken(this.assembler.parser.getPosition() - 3);

		if (labelToken?.type !== "IDENTIFIER" || labelToken.line !== directive.line) throw new Error("Missing symbol name before .EQU.");

		const label = this.assembler.lastGlobalLabel;
		if (!label) throw new Error("Missing symbol name before .EQU.");

		this.assembler.lastGlobalLabel = null;

		const expressionTokens = this.assembler.parser.getInstructionTokens();

		const value = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);

		this.lister.symbol(label, value);

		const statement = this.assembler.currentStatement ?? directive;
		this.assembler.symbolTable.defineConstant(label, value, {
			filename: context.filename,
			line: statement.line,
			column: statement.column,
		});
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const label = this.assembler.lastGlobalLabel;
		if (!label) throw new Error("Missing label name.");

		const expressionTokens = this.assembler.parser.getInstructionTokens(directive);

		const value = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);

		// If evaluation produced undefined, treat as an error in Pass 2
		if (value === undefined) throw new Error(`Unresolved assignment for ${label}.`);

		this.lister.symbol(label, value);

		this.assembler.symbolTable.updateSymbol(label, value);
	}
}
