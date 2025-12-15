import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export class AlignDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const alignExpressionTokens = this.runtime.parser.getInstructionTokens();
		const [boundaryTokens] = this.parseArguments(alignExpressionTokens);

		try {
			const boundary = this.runtime.evaluator.evaluateAsNumber(boundaryTokens, context);
			if (boundary <= 0) return;

			// Check if boundary is a power of two, which is a common requirement.
			if ((boundary & 1) !== 0) this.runtime.logger.warn(`Warning on line ${directive.line}: .ALIGN boundary $${getHex(boundary)} is not a power of two.`);

			const newPC = (context.PC.value + boundary - 1) & ~(boundary - 1);
			context.PC.value = newPC;
		} catch (e) {
			this.runtime.logger.warn(`Warning on line ${directive.line}: Could not evaluate .ALIGN expression. ${e}`);
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const alignExpressionTokens = this.runtime.parser.getInstructionTokens();
		const [boundaryTokens, valueTokens] = this.parseArguments(alignExpressionTokens);

		try {
			const boundary = this.runtime.evaluator.evaluateAsNumber(boundaryTokens, context);
			if (boundary <= 0) return;

			const fillerValue = valueTokens.length > 0 ? this.runtime.evaluator.evaluateAsNumber(valueTokens, context) : 0; // Default to 0 if no value is provided

			const newPC = (context.PC.value + boundary - 1) & ~(boundary - 1);
			const paddingBytes = newPC - context.PC.value;

			if (context.isAssembling && paddingBytes > 0) {
				// Ensure filler value is a single byte
				const filler = fillerValue & 0xff;
				const bytes = new Array(paddingBytes).fill(filler);
				context.emitbytes(bytes);
			} else {
				context.PC.value = newPC;
			}
		} catch (e) {
			this.runtime.logger.error(`ERROR on line ${directive.line}: Failed to evaluate .ALIGN expression. ${e}`);
		}
	}

	/**
	 * Parses the argument tokens into boundary and value expressions.
	 * @returns A tuple containing [boundaryTokens, valueTokens].
	 */
	private parseArguments(tokens: Token[]): [Token[], Token[]] {
		const commaIndex = tokens.findIndex((t) => t.type === "COMMA");

		// No comma, all tokens are for the boundary.
		if (commaIndex === -1) return [tokens, []];

		const boundaryTokens = tokens.slice(0, commaIndex);
		const valueTokens = tokens.slice(commaIndex + 1);
		return [boundaryTokens, valueTokens];
	}
}
