import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export type StringFormat = "TEXT" | "CSTR" | "PSTR" | "PSTRL";

export class StringDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly runtime: DirectiveRuntime,
		private readonly format: StringFormat,
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

		this.runtime.lister.bytes({
			addr: context.PC.value,
			bytes,
			text: `.${directive.value.toLowerCase()} ${strings.map((s) => `"${s}"`).join(" ")}`,
			hasText: true,
		});

		context.emitbytes(bytes);
	}

	private getStrings(directive: ScalarToken, context: DirectiveContext): string[] {
		const strings: string[] = [];

		while (!this.runtime.parser.isEOS()) {
			const exprTokens = this.runtime.parser.getExpressionTokens(directive);
			const value = this.runtime.evaluator.evaluate(exprTokens, context) as string;
			if (!context.allowForwardRef && typeof value !== "string")
				throw new Error(`Data directive expression must evaluate to a string on line ${directive.line}.`);
			strings.push(value);
			if (!this.runtime.parser.is("COMMA")) break;
			this.runtime.parser.next();
		}

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
