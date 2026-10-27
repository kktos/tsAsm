import type { Assembler } from "../assembler/polyasm";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
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
		const nameToken = this.procName(directive);

		// Define the procedure name as a label in the current scope.
		const statement = this.assembler.currentStatement ?? directive;
		if (this.assembler.pass === 1)
			this.assembler.symbolTable.defineLabel(nameToken.value, context.PC.value, {
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

	/** The procedure's name, on the directive's line: a word on the next line is the body's. */
	private procName(directive: ScalarToken): ScalarToken {
		const token = this.assembler.parser.peek();
		if (!token || token.type === "EOF" || token.line !== directive.line) throw AsmError.at("A procedure needs a name.", directive);
		if (token.type !== "IDENTIFIER") throw AsmError.at("A procedure needs a name.", token);
		this.assembler.parser.advance();
		return token as ScalarToken;
	}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		this.defineAndScope(directive, context);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		this.defineAndScope(directive, context);
	}
}
