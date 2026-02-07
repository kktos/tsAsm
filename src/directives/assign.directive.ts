import type { Assembler } from "../assembler/polyasm";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class AssignDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: ILister,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const labelToken = this.assembler.parser.ensureToken(this.assembler.parser.getPosition() - 2);

		const isOnSameLine = labelToken?.line === directive.line;
		const isValidType = labelToken?.type === "IDENTIFIER" || (labelToken?.type === "OPERATOR" && labelToken.value === "*");
		if (!isOnSameLine || !isValidType) throw `Syntax error in line ${directive.line} - Missing symbol name before =`;

		const label = this.assembler.lastGlobalLabel;
		if (!label) throw `Syntax error in line ${directive.line} - Missing symbol name before =`;

		this.assembler.lastGlobalLabel = null;

		const expressionTokens = this.assembler.parser.getInstructionTokens();

		const value = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);

		this.lister.symbol(label, value);

		if (label === "*") {
			if (typeof value !== "number") throw `line ${directive.line} - Invalid value for */ORG ${value}`;
			context.PC.value = value;
			return;
		}

		this.assembler.symbolTable.defineVariable(label, value, { filename: context.filename, line: directive.line, column: directive.column });
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const label = this.assembler.lastGlobalLabel;
		if (!label) throw new Error(`Syntax error in line ${directive.line} - Missing label name`);

		const expressionTokens = this.assembler.parser.getInstructionTokens(directive);

		const value = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);

		// If evaluation produced undefined, treat as an error in Pass 2
		if (value === undefined) throw new Error(`line ${directive.line}: Unresolved assignment for ${label}`);

		this.lister.symbol(label, value);

		if (label === "*") {
			if (typeof value !== "number") throw new Error(`line ${directive.line} - Invalid value for */ORG ${value}`);
			context.PC.value = value;
			return;
		}

		// In functions & Macros, the scope is lost between the passes
		if (this.assembler.symbolTable.isVolatileScope() && this.assembler.symbolTable.findSymbol(label) === undefined)
			this.assembler.symbolTable.defineVariable(label, value, { filename: context.filename, line: directive.line, column: directive.column });
		else this.assembler.symbolTable.assignVariable(label, value);
	}
}
