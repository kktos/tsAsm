import type { Assembler } from "../assembler/polyasm";
import type { StreamState } from "../assembler/polyasm.types";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class AssignDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		const labelToken = assembler.parser.ensureToken(assembler.parser.getPosition() - 2);

		const isOnSameLine = labelToken?.line === directive.line;
		const isValidType = labelToken?.type === "IDENTIFIER" || (labelToken?.type === "OPERATOR" && labelToken.value === "*");
		if (!isOnSameLine || !isValidType) throw `Syntax error in line ${directive.line} - Missing symbol name before =`;

		const label = assembler.lastGlobalLabel;
		if (!label) throw `Syntax error in line ${directive.line} - Missing symbol name before =`;

		assembler.lastGlobalLabel = null;

		const expressionTokens = assembler.parser.getInstructionTokens();

		const value = assembler.expressionEvaluator.evaluate(expressionTokens, {
			pc: assembler.currentPC,
			allowForwardRef: true,
			currentGlobalLabel: label,
			macroArgs: (assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
		});

		assembler.lister.symbol(label, value);

		if (label === "*") {
			if (typeof value !== "number") throw `line ${directive.line} - Invalid value for */ORG ${value}`;
			assembler.currentPC = value;
			return;
		}

		assembler.symbolTable.defineVariable(label, value);
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

		if (label === "*") {
			if (typeof value !== "number") throw `line ${directive.line} - Invalid value for */ORG ${value}`;
			assembler.currentPC = value;
			return;
		}

		// In functions & Macros, the scope is lost between the passes
		assembler.symbolTable.assignVariable(label, value);
	}
}
