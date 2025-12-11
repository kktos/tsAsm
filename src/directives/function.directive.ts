import type { Assembler } from "../assembler/polyasm";
import type { Lister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class FunctionDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: Lister,
	) {}

	private defineAndScope(directive: ScalarToken, context: DirectiveContext) {
		const nameToken = this.assembler.parser.next() as ScalarToken;
		if (nameToken?.type !== "IDENTIFIER") throw new Error(`line ${directive.line}: Expected function name after .FUNCTION directive.`);

		// Define the function name as a label in the current scope.
		if (this.assembler.pass === 1) this.assembler.symbolTable.defineConstant(nameToken.value, context.pc);
		else this.assembler.symbolTable.updateSymbol(nameToken.value, context.pc);

		// this.logger.log(`Defined function label '${nameToken.value}' @ $${context.pc.toString(16)}`);
		this.lister.directive(directive, nameToken.raw as string);

		const scopeId = `@@function_${this.assembler.symbolTable.getSymbolFullPath(nameToken.value)}`;
		this.assembler.symbolTable.restoreAndPushScope(scopeId);

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
