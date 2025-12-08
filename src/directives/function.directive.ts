import type { ScalarToken } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class FunctionDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	private defineAndScope(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		const nameToken = assembler.parser.next() as ScalarToken;
		if (nameToken?.type !== "IDENTIFIER") throw new Error(`line ${directive.line}: Expected function name after .FUNCTION directive.`);

		// Define the function name as a label in the current scope.
		if (assembler.pass === 1) assembler.symbolTable.defineConstant(nameToken.value, context.pc);
		else assembler.symbolTable.updateSymbol(nameToken.value, context.pc);

		// assembler.logger.log(`Defined function label '${nameToken.value}' @ $${context.pc.toString(16)}`);
		assembler.lister.directive(directive, nameToken.raw as string);

		const scopeId = `@@function_${assembler.symbolTable.getSymbolFullPath(nameToken.value)}`;
		assembler.symbolTable.pushScope(scopeId);

		const body = assembler.parser.getDirectiveBlockTokens(directive.value);
		assembler.parser.pushTokenStream({
			cacheName: scopeId,
			newTokens: assembler.pass === 1 ? body : [],
			onEndOfStream: () => assembler.symbolTable.popScope(),
			macroArgs: context.macroArgs,
		});
	}

	public handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		this.defineAndScope(directive, assembler, context);
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		this.defineAndScope(directive, assembler, context);
	}
}
