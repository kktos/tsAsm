import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { assertFitsInBytes } from "../utils/number.utils";
import { findTopLevelComma } from "../utils/token.utils";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export class FillDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const argTokens = this.runtime.parser.getInstructionTokens(directive);

		const [countTokens] = this.parseArguments(argTokens);

		if (countTokens.length > 0) {
			let byteCount: number | null;
			try {
				byteCount = this.runtime.evaluator.evaluateAsNumber(countTokens, context);
			} catch (e) {
				// Error evaluating in pass one, but we must continue. Assume 0 size.
				this.runtime.warn(`Could not evaluate the .FILL count: ${e instanceof Error ? e.message : e}`);
				return;
			}
			// A symbol defined later: assume 0 size, pass 2 will know.
			if (byteCount === null) return;
			this.assertValidCount(byteCount, directive);

			context.PC.value += byteCount;
			this.runtime.lister.directive(directive, `<${byteCount} bytes>`);
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const argTokens = this.runtime.parser.getInstructionTokens(directive);
		const [countTokens, valueTokens] = this.parseArguments(argTokens);
		const count = this.runtime.evaluator.evaluateAsNumber(countTokens, context);
		this.assertValidCount(count, directive);

		const fillerValue = valueTokens.length > 0 ? this.runtime.evaluator.evaluateAsNumber(valueTokens, context) : 0;
		assertFitsInBytes(fillerValue, 1, `.${directive.value} value:`);

		if (count > 0) {
			// Ensure filler value is a single byte
			const byteValue = fillerValue & 0xff;
			const bytes = Array.from({ length: count }, () => byteValue);
			// Emitting moves the PC past the bytes: list them where they start.
			const addr = context.PC.value;
			context.emitbytes(bytes);

			this.runtime.lister.directiveWithBytes({
				addr,
				bytes,
				pragma: directive,
				params: [count as SymbolValue, fillerValue as SymbolValue] as SymbolValue[][],
				hasText: false,
			});
		}
	}

	private assertValidCount(count: number | null, directive: ScalarToken) {
		if (!Number.isInteger(count) || (count as number) < 0)
			throw new Error(`.${directive.value} count: ${count} isn't a whole number of bytes (0 or more).`);
	}

	/**
	 * Parses the argument tokens into count and value expressions.
	 * @returns A tuple containing [countTokens, valueTokens].
	 */
	private parseArguments(tokens: Token[]): [Token[], Token[]] {
		const commaIndex = findTopLevelComma(tokens);

		if (commaIndex === -1) {
			// No comma, all tokens are for the count.
			return [tokens, []];
		}

		const countTokens = tokens.slice(0, commaIndex);
		const valueTokens = tokens.slice(commaIndex + 1);
		return [countTokens, valueTokens];
	}
}
