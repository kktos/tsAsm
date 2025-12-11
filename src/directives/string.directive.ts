import type { Assembler } from "../assembler/polyasm";
import type { Lister } from "../helpers/lister.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export type StringFormat = "TEXT" | "CSTR" | "PSTR" | "PSTRL";

export class StringDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly format: StringFormat,
		private readonly lister: Lister,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		context.PC.value += this.calculateSize(directive, context);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		// If not assembling, just advance PC
		if (!context.isAssembling) {
			context.PC.value += this.calculateSize(directive, context);
			return;
		}

		const strings = this.getStrings(directive, context);
		const bytes = this.encodeData(directive, strings);

		this.lister.bytes({
			addr: context.PC.value,
			bytes,
			text: `.${directive.value} ${strings.map((s) => `"${s}"`).join(" ")}`,
			hasText: true,
		});

		context.writebytes(bytes);
	}

	private getStrings(directive: ScalarToken, context: DirectiveContext): string[] {
		const argTokens = this.assembler.parser.getInstructionTokens();
		const strings: string[] = [];
		let currentExpression: Token[] = [];

		const evaluateAndPush = () => {
			if (currentExpression.length === 0) return;

			const value = this.assembler.expressionEvaluator.evaluate(currentExpression, context) as string;
			if (!context.allowForwardRef && typeof value !== "string")
				throw new Error(`Data directive expression must evaluate to a string on line ${directive.line}.`);

			strings.push(value);
			currentExpression = [];
		};

		for (const token of argTokens) {
			if (token.type === "COMMA") evaluateAndPush();
			else currentExpression.push(token);
		}

		evaluateAndPush();
		return strings;
	}

	private calculateSize(directive: ScalarToken, context: DirectiveContext): number {
		const strings = this.getStrings(directive, {
			...context,
			allowForwardRef: true,
		});
		let totalSize = 0;
		for (const str of strings) {
			totalSize += str.length;
			switch (this.format) {
				case "CSTR":
					totalSize += 1;
					break;
				case "PSTR":
					totalSize += 1;
					break;
				case "PSTRL":
					totalSize += 2;
					break;
			}
		}
		return totalSize;
	}

	private encodeData(directive: ScalarToken, strings: string[]): number[] {
		const outputBytes: number[] = [];

		for (const str of strings) {
			const chars = str.split("").map((c) => c.charCodeAt(0));

			switch (this.format) {
				case "TEXT":
					outputBytes.push(...chars);
					break;
				case "CSTR":
					outputBytes.push(...chars, 0);
					break;
				case "PSTR":
					if (str.length > 255) throw new Error(`.PSTR string length cannot exceed 255 bytes on line ${directive.line}.`);
					outputBytes.push(str.length, ...chars);
					break;
				case "PSTRL":
					if (str.length > 65535) throw new Error(`.PSTRL string length cannot exceed 65535 bytes on line ${directive.line}.`);
					outputBytes.push(str.length & 0xff, (str.length >> 8) & 0xff, ...chars); // Little-endian length
					break;
			}
		}
		return outputBytes;
	}
}
