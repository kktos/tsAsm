import type { ScalarToken, Token } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class DataDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly bytesPerElement: number) {}

	public handlePassOne(_directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		if (assembler.isAssembling) assembler.currentPC += this.calculateDirectiveSize(assembler);
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
		const argTokens = assembler.parser.getInstructionTokens();
		const outputBytes: number[] = [];
		let currentExpression: Token[] = [];
		const params: Token[][] = [];
		let hasText = false;

		const evaluateAndPush = () => {
			if (currentExpression.length === 0) return;

			params.push(currentExpression);

			const value = assembler.expressionEvaluator.evaluateAsNumber(currentExpression, context);

			for (let i = 0; i < this.bytesPerElement; i++) outputBytes.push((value >> (i * 8)) & 0xff);

			currentExpression = [];
		};

		for (const token of argTokens) {
			switch (token.type) {
				case "STRING": {
					evaluateAndPush(); // Push any pending expression before the string
					const strValue = token.value;
					for (let i = 0; i < strValue.length; i++) outputBytes.push(strValue.charCodeAt(i));
					params.push([token]);
					hasText = true;
					break;
				}
				case "COMMA":
					evaluateAndPush(); // Evaluate and push the expression before the comma
					break;
				default:
					currentExpression.push(token);
			}
		}

		evaluateAndPush(); // Push the last expression

		assembler.lister.directiveWithBytes({
			addr: context.pc,
			bytes: outputBytes,
			pragma: directive,
			params,
			hasText,
		});
		return outputBytes;
	}
}
