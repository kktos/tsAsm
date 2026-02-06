import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export class DataDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly runtime: DirectiveRuntime,
		private readonly bytesPerElement: number,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		if (context.isAssembling) {
			// const byteCount = this.calculateDirectiveSize();
			const byteCount = this.calculateDirectiveSize(directive, context);
			context.PC.value += byteCount;
			this.runtime.lister.directive(directive, `<${byteCount} bytes>`);
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		if (context.isAssembling) {
			const bytes = this.encodeDataDirective(directive, context);
			context.emitbytes(bytes);
		}
	}

	private calculateDirectiveSize(directive: ScalarToken, context: DirectiveContext): number {
		let totalSize = 0;

		while (true) {
			const exprTokens = this.runtime.parser.getExpressionTokens(directive);
			if (exprTokens.length === 0) break;

			const value = this.runtime.evaluator.evaluate(exprTokens, context);

			switch (typeof value) {
				case "object": {
					if (value !== null) throw new Error(`Unexpected object value ${value}.`);
					totalSize += this.bytesPerElement;
					break;
				}
				case "string": {
					totalSize += value.length;
					break;
				}
				case "number": {
					totalSize += this.bytesPerElement;
					break;
				}
				default:
					throw new Error(`Unexpected value type ${typeof value}.`);
			}

			if (this.runtime.parser.isEOS() || !this.runtime.parser.is("COMMA")) break;

			this.runtime.parser.advance();
		}

		return totalSize;
	}

	private encodeDataDirective(directive: ScalarToken, context: DirectiveContext): number[] {
		const outputBytes: number[] = [];
		const params: SymbolValue[] = [];
		let hasText = false;

		while (true) {
			const exprTokens = this.runtime.parser.getExpressionTokens(directive);
			if (exprTokens.length === 0) break;

			const value = this.runtime.evaluator.evaluate(exprTokens, context);

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

			if (this.runtime.parser.isEOS() || !this.runtime.parser.is("COMMA")) break;

			this.runtime.parser.advance();
		}

		this.runtime.lister.directiveWithBytes({
			addr: context.PC.value,
			bytes: outputBytes,
			pragma: directive,
			params: params as SymbolValue[][],
			hasText,
		});

		return outputBytes;
	}
}
