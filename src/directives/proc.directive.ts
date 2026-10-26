import type { Assembler } from "../assembler/polyasm";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

/** `.proc` / `.procedure`: a routine whose labels stay local to it. */
export class ProcDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: ILister,
	) {}

	private defineAndScope(directive: ScalarToken, context: DirectiveContext) {
		const nameToken = this.assembler.parser.next() as ScalarToken;
		if (nameToken?.type !== "IDENTIFIER") throw new Error(`Expected a name after .${directive.value}.`);

		// Define the procedure name as a label in the current scope.
		const statement = this.assembler.currentStatement ?? directive;
		if (this.assembler.pass === 1)
			this.assembler.symbolTable.defineConstant(nameToken.value, context.PC.value, {
				filename: context.filename,
				line: statement.line,
				column: statement.column,
			});
		else this.assembler.symbolTable.updateSymbol(nameToken.value, context.PC.value);

		this.lister.directive(directive, nameToken.raw as string);

		const scopeId = `@@proc_${this.assembler.symbolTable.getSymbolFullPath(nameToken.value)}`;
		this.assembler.symbolTable.restoreAndPushScope(scopeId, `proc ${nameToken.raw ?? nameToken.value}`);

		const body = this.assembler.parser.getDirectiveBlockTokens(directive.value);
		this.assembler.parser.pushTokenStream({
			cacheName: scopeId,
			newTokens: this.assembler.pass === 1 ? body : [],
			onEndOfStream: () => this.assembler.symbolTable.popScope({ wannaSave: this.assembler.pass === 1 }),
			macroArgs: context.macroArgs,
		});
	}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		this.defineAndScope(directive, context);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		this.defineAndScope(directive, context);
	}
}
