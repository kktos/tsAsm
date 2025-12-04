import type { ScalarToken } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class FunctionDirective implements IDirective {
	private static functionIdCounter = 0;

	private defineAndScope(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		const nameToken = assembler.parser.nextToken() as ScalarToken;
		if (nameToken?.type !== "IDENTIFIER") throw new Error(`ERROR on line ${directive.line}: Expected function name after .FUNCTION directive.`);

		// Define the function name as a label in the current scope.
		if (assembler.pass === 1) assembler.symbolTable.addSymbol(nameToken.value, context.pc);
		else assembler.symbolTable.setSymbol(nameToken.value, context.pc);

		assembler.logger.log(`Defined function label '${nameToken.value}' @ $${context.pc.toString(16)}`);

		const scopeId = `function_${nameToken.value}_${FunctionDirective.functionIdCounter++}`;
		assembler.symbolTable.pushScope(scopeId);

		const body = assembler.parser.getDirectiveBlockTokens(directive.value);

		const streamId = assembler.parser.getNextStreamId();
		assembler.emitter.once(`endOfStream:${streamId}`, () => {
			assembler.symbolTable.popScope();
		});

		assembler.parser.pushTokenStream({ newTokens: body, streamId });
	}

	public handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		this.defineAndScope(directive, assembler, context);
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		this.defineAndScope(directive, assembler, context);
	}
}
