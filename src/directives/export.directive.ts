import type { Assembler } from "../assembler/polyasm";
import type { Lister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class ExportDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly lister: Lister) {}
	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		const symbolToken = assembler.parser.identifier();

		this.lister.directive(directive, symbolToken.value);

		const symbol = assembler.symbolTable.findSymbol(symbolToken.value);

		try {
			assembler.symbolTable.defineConstant(`global::${symbolToken.value}`, symbol?.symbol.value ?? 0);
		} catch (e) {
			throw `line ${directive.line}: Can't export variable symbol ${symbolToken.value} - ${e}`;
		}
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext): void {
		const symbolToken = assembler.parser.identifier();

		this.lister.directive(directive, symbolToken.value);

		const symbol = assembler.symbolTable.findSymbol(symbolToken.value);
		if (symbol === undefined) throw `line ${directive.line}: Can't export undefined symbol ${symbolToken.value}`;
		if (!symbol.symbol.isConstant) throw `line ${directive.line}: Can't export variable symbol ${symbolToken.value}`;

		// In functions & Macros, the scope is lost between the passes
		assembler.symbolTable.updateSymbol(`global::${symbolToken.value}`, symbol.symbol.value);
	}
}
