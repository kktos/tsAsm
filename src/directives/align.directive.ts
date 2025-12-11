import type { Assembler } from "../assembler/polyasm";
import type { Logger } from "../helpers/logger.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class AlignDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly logger: Logger) {}

	public handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		const alignExpressionTokens = assembler.parser.getInstructionTokens();
		const [boundaryTokens] = this.parseArguments(alignExpressionTokens);

		try {
			const boundary = assembler.expressionEvaluator.evaluateAsNumber(boundaryTokens, context);
			if (boundary <= 0) return;

			// Check if boundary is a power of two, which is a common requirement.
			if ((boundary & 1) !== 0) this.logger.warn(`Warning on line ${directive.line}: .ALIGN boundary $${getHex(boundary)} is not a power of two.`);

			const newPC = (assembler.currentPC + boundary - 1) & ~(boundary - 1);
			assembler.currentPC = newPC;
		} catch (e) {
			this.logger.warn(`Warning on line ${directive.line}: Could not evaluate .ALIGN expression. ${e}`);
		}
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		const alignExpressionTokens = assembler.parser.getInstructionTokens();
		const [boundaryTokens, valueTokens] = this.parseArguments(alignExpressionTokens);

		try {
			const boundary = assembler.expressionEvaluator.evaluateAsNumber(boundaryTokens, context);
			if (boundary <= 0) return;

			const fillerValue = valueTokens.length > 0 ? assembler.expressionEvaluator.evaluateAsNumber(valueTokens, context) : 0; // Default to 0 if no value is provided

			const newPC = (assembler.currentPC + boundary - 1) & ~(boundary - 1);
			const paddingBytes = newPC - assembler.currentPC;

			if (context.isAssembling && paddingBytes > 0) {
				// Ensure filler value is a single byte
				const filler = fillerValue & 0xff;
				const bytes = new Array(paddingBytes).fill(filler);
				context.writebytes(bytes);
			} else {
				assembler.currentPC = newPC;
			}
		} catch (e) {
			this.logger.error(`ERROR on line ${directive.line}: Failed to evaluate .ALIGN expression. ${e}`);
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
