import type { ScalarToken } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class ExportDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		const symbolToken = assembler.parser.identifier();

		assembler.lister.directive(directive, symbolToken.value);

		const symbol = assembler.symbolTable.findSymbol(symbolToken.value);

		try {
			assembler.symbolTable.defineConstant(`global::${symbolToken.value}`, symbol?.symbol.value ?? 0);
		} catch (e) {
			throw `line ${directive.line}: Can't export variable symbol ${symbolToken.value} - ${e}`;
		}
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		const symbolToken = assembler.parser.identifier();

		assembler.lister.directive(directive, symbolToken.value);

		const symbol = assembler.symbolTable.findSymbol(symbolToken.value);
		if (symbol === undefined) throw `line ${directive.line}: Can't export undefined symbol ${symbolToken.value}`;
		if (!symbol.symbol.isConstant) throw `line ${directive.line}: Can't export variable symbol ${symbolToken.value}`;

		// In functions & Macros, the scope is lost between the passes
		assembler.symbolTable.updateSymbol(`global::${symbolToken.value}`, symbol.symbol.value);
	}
}
