import type { Assembler } from "../assembler/polyasm";
import type { Logger } from "../helpers/logger.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class FillDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly logger: Logger,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const argTokens = this.assembler.parser.getInstructionTokens();

		const [countTokens] = this.parseArguments(argTokens);

		if (countTokens.length > 0) {
			try {
				const count = this.assembler.expressionEvaluator.evaluateAsNumber(countTokens, context);
				context.PC.value += count;
			} catch (e) {
				// Error evaluating in pass one, but we must continue. Assume 0 size.
				this.logger.warn(`Warning on line ${directive.line}: Could not evaluate .FILL count. ${e}`);
			}
		}
	}

	public handlePassTwo(_directive: ScalarToken, context: DirectiveContext): void {
		const argTokens = this.assembler.parser.getInstructionTokens();

		const [countTokens, valueTokens] = this.parseArguments(argTokens);

		const count = this.assembler.expressionEvaluator.evaluateAsNumber(countTokens, context);
		const fillerValue = valueTokens.length > 0 ? this.assembler.expressionEvaluator.evaluateAsNumber(valueTokens, context) : 0; // Default to 0 if no value is provided

		if (context.isAssembling && count > 0) {
			// Ensure filler value is a single byte
			const byteValue = fillerValue & 0xff;
			const bytes = new Array(count).fill(byteValue);
			context.writebytes(bytes);
		}

		// Advance PC if not assembling; writeBytes already advances PC when assembling
		if (!context.isAssembling) context.PC.value += count;
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
