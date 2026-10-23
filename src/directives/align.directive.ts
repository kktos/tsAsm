import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { assertFitsInBytes } from "../utils/number.utils";
import { findTopLevelComma } from "../utils/token.utils";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export class AlignDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const alignExpressionTokens = this.runtime.parser.getInstructionTokens();
		const [boundaryTokens] = this.parseArguments(alignExpressionTokens);

		let boundary: number | null;
		try {
			boundary = this.runtime.evaluator.evaluateAsNumber(boundaryTokens, context);
		} catch (e) {
			this.runtime.warn(`Could not evaluate the .ALIGN boundary: ${e instanceof Error ? e.message : e}`);
			return;
		}
		// A symbol defined later: pass 2 will know.
		if (boundary === null) return;
		this.assertPowerOfTwo(boundary);

		const newPC = (context.PC.value + boundary - 1) & ~(boundary - 1);
		const paddingBytesCount = newPC - context.PC.value;

		context.PC.value = newPC;

		this.runtime.lister.directive(directive, `${boundary} <${paddingBytesCount} bytes>`);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const alignExpressionTokens = this.runtime.parser.getInstructionTokens();
		const [boundaryTokens, valueTokens] = this.parseArguments(alignExpressionTokens);

		// All symbols are known in pass 2, so an evaluation error is a real error: let it propagate.
		const boundary = this.runtime.evaluator.evaluateAsNumber(boundaryTokens, context);
		this.assertPowerOfTwo(boundary);

		const fillerValue = valueTokens.length > 0 ? this.runtime.evaluator.evaluateAsNumber(valueTokens, context) : 0; // Default to 0 if no value is provided
		assertFitsInBytes(fillerValue, 1, `.${directive.value} value:`);

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

	/** The padding is computed with a bit mask, which only works for a power of two: anything else is an error. */
	private assertPowerOfTwo(boundary: number) {
		if (!Number.isInteger(boundary) || !Number.isInteger(Math.log2(boundary)))
			throw new Error(`.ALIGN boundary: ${boundary} is not a power of two (1, 2, 4, 8, ...).`);
	}

	/**
	 * Parses the argument tokens into boundary and value expressions.
	 * @returns A tuple containing [boundaryTokens, valueTokens].
	 */
	private parseArguments(tokens: Token[]): [Token[], Token[]] {
		const commaIndex = findTopLevelComma(tokens);

		// No comma, all tokens are for the boundary.
		if (commaIndex === -1) return [tokens, []];

		const boundaryTokens = tokens.slice(0, commaIndex);
		const valueTokens = tokens.slice(commaIndex + 1);
		return [boundaryTokens, valueTokens];
	}
}
