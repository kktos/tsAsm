import type { Assembler } from "../assembler/polyasm";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class ExportDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: ILister,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const symbolToken = this.assembler.parser.identifier();

		this.lister.directive(directive, symbolToken.value);

		const symbol = this.assembler.symbolTable.findSymbol(symbolToken.value);

		try {
			this.assembler.symbolTable.defineConstant(`global::${symbolToken.value}`, symbol?.symbol.value ?? 0, {
				filename: context.filename,
				line: directive.line,
				column: directive.column,
			});
		} catch (e) {
			throw `line ${directive.line}: Can't export variable symbol ${symbolToken.value} - ${e}`;
		}
	}

	public handlePassTwo(directive: ScalarToken, _context: DirectiveContext): void {
		const symbolToken = this.assembler.parser.identifier();

		this.lister.directive(directive, symbolToken.value);

		const symbol = this.assembler.symbolTable.findSymbol(symbolToken.value);
		if (symbol === undefined) throw `line ${directive.line}: Can't export undefined symbol ${symbolToken.value}`;
		if (!symbol.symbol.isConstant) throw `line ${directive.line}: Can't export variable symbol ${symbolToken.value}`;

		// In functions & Macros, the scope is lost between the passes
		this.assembler.symbolTable.updateSymbol(`global::${symbolToken.value}`, symbol.symbol.value);
	}
}
