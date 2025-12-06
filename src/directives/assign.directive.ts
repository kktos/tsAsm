import type { ScalarToken } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class AssignDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		const label = assembler.getLastGlobalLabel();
		if (!label) throw new Error(`Syntax error in line ${directive.line} - Missing label name`);

		assembler.handleSymbolInPassOne(directive, label);
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		const label = assembler.getLastGlobalLabel();
		if (!label) throw new Error(`Syntax error in line ${directive.line} - Missing label name`);

		assembler.handleSymbolInPassTwo(label, directive);
	}
}
