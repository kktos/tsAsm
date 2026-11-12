import type { Assembler } from "../assembler/polyasm";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import type { DirectiveContext, IDirective } from "./directive.interface";
import { forwardOrgError } from "./org.directive";
import { checkInstance, readStructType } from "./struct.directive";

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

		const { valueTokens, struct } = this.readValue(label, this.assembler.parser.getInstructionTokens(), context);

		const value = this.assembler.expressionEvaluator.evaluate(valueTokens, context);
		if (struct) checkInstance(value, struct, valueTokens[0] as Token);

		this.lister.symbol(label, value);

		if (label === "*") {
			this.assembler.linker.checkOrg();
			// A symbol defined after it: unknown in pass 1, it's null.
			if (value === null) throw forwardOrgError("* =");
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
		this.assembler.symbolTable.setStruct(label, struct);
	}

	/** The value's tokens, and its struct after `as`: the PC can't have one. */
	private readValue(label: string, tokens: Token[], context: DirectiveContext) {
		const typed = readStructType(tokens, this.assembler.expressionEvaluator, context);
		if (label === "*" && typed.struct)
			throw AsmError.at("The PC is an address, not an instance of a struct: '* =' takes no 'as'.", tokens[tokens.length - 2] as Token);
		return typed;
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const labelToken = this.labelToken() ?? directive;
		const label = this.assembler.lastGlobalLabel;
		if (!label) throw new Error("Missing label name.");

		const { valueTokens, struct } = this.readValue(label, this.assembler.parser.getInstructionTokens(directive), context);

		const value = this.assembler.expressionEvaluator.evaluate(valueTokens, context);
		if (struct) checkInstance(value, struct, valueTokens[0] as Token);

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
		this.assembler.symbolTable.setStruct(label, struct);
		this.assembler.reportAssignment(labelToken, label);
	}
}
