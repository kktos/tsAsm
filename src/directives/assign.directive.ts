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

	/** The symbol's name, before the `=`. */
	private labelToken() {
		return this.assembler.parser.ensureToken(this.assembler.parser.getPosition() - 2);
	}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const labelToken = this.labelToken();

		const isOnSameLine = labelToken?.line === directive.line;
		const isValidType = labelToken?.type === "IDENTIFIER" || (labelToken?.type === "OPERATOR" && labelToken.value === "*");
		if (!isOnSameLine || !isValidType) throw new Error("Missing symbol name before =.");

		const label = this.assembler.lastGlobalLabel;
		if (!label) throw new Error("Missing symbol name before =.");

		this.assembler.lastGlobalLabel = null;

		const expressionTokens = this.assembler.parser.getInstructionTokens();

		const value = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);

		this.lister.symbol(label, value);

		if (label === "*") {
			this.assembler.linker.checkOrg();
			if (typeof value !== "number") throw new Error(`Invalid value for */ORG: ${value}.`);
			this.assembler.checkAddress(value);
			context.PC.value = value;
			return;
		}

		this.assembler.symbolTable.defineVariable(label, value, {
			filename: context.filename,
			line: labelToken.line,
			column: labelToken.column,
		});
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const labelToken = this.labelToken() ?? directive;
		const label = this.assembler.lastGlobalLabel;
		if (!label) throw new Error("Missing label name.");

		const expressionTokens = this.assembler.parser.getInstructionTokens(directive);

		const value = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);

		// If evaluation produced undefined, treat as an error in Pass 2
		if (value === undefined) throw new Error(`Unresolved assignment for ${label}.`);

		this.lister.symbol(label, value);

		if (label === "*") {
			this.assembler.linker.checkOrg();
			if (typeof value !== "number") throw new Error(`Invalid value for */ORG: ${value}.`);
			this.assembler.checkAddress(value);
			context.PC.value = value;
			return;
		}

		// In a macro call, pass 2 gets back what pass 1 defined there. A variable pass 1 didn't define (its block wasn't
		// run) is defined now. A function call starts empty in each pass, and its variables are its own: one of the same
		// name outside is hidden, not assigned.
		const symbolTable = this.assembler.symbolTable;
		const isNew = symbolTable.isFunctionScope() ? !symbolTable.hasSymbolInScope(label) : symbolTable.findSymbol(label) === undefined;
		if (symbolTable.isVolatileScope() && isNew)
			this.assembler.symbolTable.defineVariable(label, value, {
				filename: context.filename,
				line: labelToken.line,
				column: labelToken.column,
			});
		else this.assembler.symbolTable.assignVariable(label, value);
	}
}
