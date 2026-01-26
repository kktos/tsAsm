import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export class ModuleDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		let name: SymbolValue;

		const token = this.runtime.parser.peek();
		if (token?.type === "IDENTIFIER") {
			name = token.value;
			this.runtime.parser.advance();
		} else {
			const tokens = this.runtime.parser.getInstructionTokens();
			if (tokens.length === 0) throw new Error(`ERROR on line ${directive.line}: .MODULE requires a name expression.`);
			name = this.runtime.evaluator.evaluate(tokens, context);
			if (typeof name !== "string") throw new Error(`ERROR on line ${directive.line}: .MODULE name must evaluate to a string.`);
		}

		this.runtime.linker.addModule(name);
		this.runtime.lister.directive(directive, name, `ORG $${getHex(context.PC.value)}`);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		let name: SymbolValue;

		const token = this.runtime.parser.peek();
		if (token?.type === "IDENTIFIER") {
			name = token.value;
			this.runtime.parser.advance();
		} else {
			const tokens = this.runtime.parser.getInstructionTokens();
			if (tokens.length === 0) throw new Error(`ERROR on line ${directive.line}: .MODULE requires a name expression.`);
			name = this.runtime.evaluator.evaluate(tokens, context);
			if (typeof name !== "string") throw new Error(`ERROR on line ${directive.line}: .MODULE name must evaluate to a string.`);
		}

		this.runtime.linker.useModule(name);
		this.runtime.lister.directive(directive, name);
	}
}
