import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import { assertFitsInBytes } from "../utils/number.utils";
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
			const paddingBytesCount = newPC - context.PC.value;

			context.PC.value = newPC;

			this.runtime.lister.directive(directive, `${boundary} <${paddingBytesCount} bytes>`);
		} catch (e) {
			this.runtime.logger.warn(`Warning on line ${directive.line}: Could not evaluate .ALIGN expression. ${e}`);
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const alignExpressionTokens = this.runtime.parser.getInstructionTokens();
		const [boundaryTokens, valueTokens] = this.parseArguments(alignExpressionTokens);

		// All symbols are known in pass 2, so an evaluation error is a real error: let it propagate.
		const boundary = this.runtime.evaluator.evaluateAsNumber(boundaryTokens, context);
		if (boundary <= 0) return;

		const fillerValue = valueTokens.length > 0 ? this.runtime.evaluator.evaluateAsNumber(valueTokens, context) : 0; // Default to 0 if no value is provided
		assertFitsInBytes(fillerValue, 1, `.${directive.value} value on line ${directive.line}:`);

		const oldPC = context.PC.value;

		const newPC = (context.PC.value + boundary - 1) & ~(boundary - 1);
		const paddingBytesCount = newPC - context.PC.value;

		if (paddingBytesCount > 0) {
			// Ensure filler value is a single byte
			const filler = fillerValue & 0xff;
			const bytes = new Array(paddingBytesCount).fill(filler);
			context.emitbytes(bytes);

			this.runtime.lister.directiveWithBytes({
				addr: oldPC,
				bytes,
				pragma: directive,
				params: [boundary, paddingBytesCount, fillerValue as SymbolValue] as SymbolValue[][],
				hasText: false,
			});
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
