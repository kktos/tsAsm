import type { Assembler } from "../assembler/polyasm";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";
import { checkInstance, readStructType } from "./struct.directive";

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

		const { value, struct } = this.readValue(this.assembler.parser.getInstructionTokens(), context);

		this.lister.symbol(label, value);

		this.assembler.symbolTable.defineConstant(label, value, {
			filename: context.filename,
			line: labelToken.line,
			column: labelToken.column,
		});
		this.assembler.symbolTable.setStruct(label, struct);
	}

	/** The value, and its struct after `as`. */
	private readValue(tokens: Token[], context: DirectiveContext) {
		const { valueTokens, struct } = readStructType(tokens, this.assembler.expressionEvaluator, context, this.assembler.parser.peek());
		const value = this.assembler.expressionEvaluator.evaluate(valueTokens, context);
		if (struct) checkInstance(value, struct, valueTokens[0] as Token);
		return { value, struct };
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const label = this.assembler.lastGlobalLabel;
		if (!label) throw new Error("Missing label name.");

		const { value, struct } = this.readValue(this.assembler.parser.getInstructionTokens(directive), context);

		// If evaluation produced undefined, treat as an error in Pass 2
		if (value === undefined) throw new Error(`Unresolved assignment for ${label}.`);

		this.lister.symbol(label, value);

		this.assembler.symbolTable.updateSymbol(label, value);
		this.assembler.symbolTable.setStruct(label, struct);
	}
}
