import type { Assembler } from "../assembler/polyasm";
import type { StreamState } from "../assembler/polyasm.types";
import type { SymbolValue } from "../assembler/symbol.class";
import type { Lister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class DataDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly bytesPerElement: number,
		private readonly lister: Lister,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		if (context.isAssembling) {
			const byteCount = this.calculateDirectiveSize();
			this.assembler.currentPC += byteCount;
			this.lister.directive(directive, `<${byteCount} bytes>`);
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		if (context.isAssembling) {
			const bytes = this.encodeDataDirective(directive, context);
			context.writebytes(bytes);
		}
	}

	private calculateDirectiveSize(): number {
		if (this.bytesPerElement === 0) {
			// Special case for .TEXT or similar string-only directives
		}

		const argTokens = this.assembler.parser.getInstructionTokens();
		if (argTokens.length === 0) return 0;

		let totalSize = 0;
		let isElement = false;

		for (const token of argTokens) {
			switch (token.type) {
				case "STRING":
					totalSize += token.value.length;
					isElement = true;
					break;
				case "COMMA":
					// Comma resets the flag, so the next non-comma token starts a new element
					isElement = false;
					break;
				default:
					if (!isElement) {
						// This is the start of a new numeric element
						totalSize += this.bytesPerElement;
						isElement = true;
					}
					break;
			}
		}

		return totalSize;
	}

	private encodeDataDirective(directive: ScalarToken, context: DirectiveContext): number[] {
		const outputBytes: number[] = [];
		const params: SymbolValue[] = [];
		let hasText = false;

		while (true) {
			const exprTokens = this.assembler.parser.getExpressionTokens(directive);
			if (exprTokens.length === 0) break;

			const value = this.assembler.expressionEvaluator.evaluate(exprTokens, {
				pc: this.assembler.currentPC,
				allowForwardRef: this.assembler.pass === 1,
				currentGlobalLabel: this.assembler.lastGlobalLabel,
				macroArgs: (this.assembler.parser.tokenStreamStack[this.assembler.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
			});

			switch (typeof value) {
				case "string": {
					for (let i = 0; i < value.length; i++) outputBytes.push(value.charCodeAt(i));
					params.push(value);
					hasText = true;
					break;
				}
				case "number": {
					for (let i = 0; i < this.bytesPerElement; i++) outputBytes.push((value >> (i * 8)) & 0xff);
					params.push(value);
					break;
				}
			}

			if (this.assembler.parser.isEOS() || !this.assembler.parser.is("COMMA")) break;

			this.assembler.parser.advance();
		}

		this.lister.directiveWithBytes({
			addr: context.pc,
			bytes: outputBytes,
			pragma: directive,
			params: params as SymbolValue[][],
			hasText,
		});

		return outputBytes;
	}
}
