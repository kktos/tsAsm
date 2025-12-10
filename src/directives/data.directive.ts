import type { ScalarToken } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { SymbolValue } from "../symbol.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class DataDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly bytesPerElement: number) {}

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		if (assembler.isAssembling) {
			const size = this.calculateDirectiveSize(assembler);
			assembler.currentPC += size;
			assembler.lister.directive(directive, `<${size} bytes>`);
		}
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		if (assembler.isAssembling) {
			const bytes = this.encodeDataDirective(directive, assembler, context);
			assembler.writeBytes(bytes);
		}
	}

	private calculateDirectiveSize(assembler: Assembler): number {
		if (this.bytesPerElement === 0) {
			// Special case for .TEXT or similar string-only directives
		}

		const argTokens = assembler.parser.getInstructionTokens();
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

	private encodeDataDirective(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): number[] {
		const outputBytes: number[] = [];
		const params: SymbolValue[] = [];
		let hasText = false;

		while (true) {
			const exprTokens = assembler.parser.getExpressionTokens(directive);
			if (exprTokens.length === 0) break;

			const value = assembler.expressionEvaluator.evaluate(exprTokens, context);

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

			if (assembler.parser.isEOS() || !assembler.parser.is("COMMA")) break;

			assembler.parser.consume();
		}

		assembler.lister.directiveWithBytes({
			addr: context.pc,
			bytes: outputBytes,
			pragma: directive,
			params: params as SymbolValue[][],
			hasText,
		});

		return outputBytes;
	}
}
