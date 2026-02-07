import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export class FillDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const argTokens = this.runtime.parser.getInstructionTokens(directive);

		const [countTokens] = this.parseArguments(argTokens);

		if (countTokens.length > 0) {
			try {
				const byteCount = this.runtime.evaluator.evaluateAsNumber(countTokens, context);
				context.PC.value += byteCount;
				this.runtime.lister.directive(directive, `<${byteCount} bytes>`);
			} catch (e) {
				// Error evaluating in pass one, but we must continue. Assume 0 size.
				this.runtime.logger.warn(`Warning on line ${directive.line}: Could not evaluate .FILL count. ${e}`);
			}
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const argTokens = this.runtime.parser.getInstructionTokens(directive);
		const [countTokens, valueTokens] = this.parseArguments(argTokens);
		const count = this.runtime.evaluator.evaluateAsNumber(countTokens, context);

		// If not assembling, just advance PC
		if (!context.isAssembling) {
			context.PC.value += count;
			return;
		}

		const fillerValue = valueTokens.length > 0 ? this.runtime.evaluator.evaluateAsNumber(valueTokens, context) : 0;

		if (count > 0) {
			// Ensure filler value is a single byte
			const byteValue = fillerValue & 0xff;
			const bytes = new Array(count).fill(byteValue);
			context.emitbytes(bytes);

			this.runtime.lister.directiveWithBytes({
				addr: context.PC.value,
				bytes,
				pragma: directive,
				params: [count as SymbolValue, fillerValue as SymbolValue] as SymbolValue[][],
				hasText: false,
			});
		}
	}

	/**
	 * Parses the argument tokens into count and value expressions.
	 * @returns A tuple containing [countTokens, valueTokens].
	 */
	private parseArguments(tokens: Token[]): [Token[], Token[]] {
		const commaIndex = tokens.findIndex((t) => t.type === "COMMA");

		if (commaIndex === -1) {
			// No comma, all tokens are for the count.
			return [tokens, []];
		}

		const countTokens = tokens.slice(0, commaIndex);
		const valueTokens = tokens.slice(commaIndex + 1);
		return [countTokens, valueTokens];
	}
}
