import type { Endianness } from "../cpu/cpuhandler.interface";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { stringToBytes } from "../utils/string.utils";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export type StringFormat = "TEXT" | "CSTR" | "PSTR" | "PSTRL";

export class StringDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly runtime: DirectiveRuntime,
		private readonly format: StringFormat,
		/** The current CPU's byte order, for the .PSTRL length (.cpu can change it). */
		private readonly getEndianness: () => Endianness,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		context.PC.value += this.calculateSize(directive, context);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
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
			const value = this.runtime.evaluator.evaluate(exprTokens, context);
			// A symbol defined later is unknown in pass 1, where the string's length is needed to place what follows.
			if (value === null) {
				const unknown = this.findUndefinedSymbol(exprTokens, context);
				const symbol = unknown ? `'${unknown}'` : "Its symbol";
				throw new Error(`.${directive.value}: ${symbol} must be defined before it is used here (its length is needed to place what follows).`);
			}
			if (typeof value !== "string") throw new Error(`.${directive.value} expression must evaluate to a string.`);
			strings.push(value);
			if (!this.runtime.parser.is("COMMA")) break;
			this.runtime.parser.next();
		}

		return strings;
	}

	/** The first symbol of the expression that isn't defined yet, looking into the arguments of macro parameters. */
	private findUndefinedSymbol(tokens: Token[], context: DirectiveContext): string | undefined {
		for (const token of tokens) {
			if (token.type !== "IDENTIFIER") continue;
			for (const t of context.macroArgs?.get(token.value) ?? [token])
				if (t.type === "IDENTIFIER" && this.runtime.symbolTable.findSymbol(t.value) === undefined) return t.value;
		}
		return undefined;
	}

	private calculateSize(directive: ScalarToken, context: DirectiveContext): number {
		const strings = this.getStrings(directive, context);
		let totalSize = 0;
		for (const str of strings) {
			totalSize += stringToBytes(str, `.${directive.value}:`).length;
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
			const chars = stringToBytes(str, `.${directive.value}:`);

			switch (this.format) {
				case "TEXT":
					outputBytes.push(...chars);
					break;
				case "CSTR":
					outputBytes.push(...chars, 0);
					break;
				case "PSTR":
					if (chars.length > 255) throw new Error(".PSTR string length cannot exceed 255 bytes.");
					outputBytes.push(chars.length, ...chars);
					break;
				case "PSTRL": {
					if (chars.length > 65535) throw new Error(".PSTRL string length cannot exceed 65535 bytes.");
					const length = [chars.length & 0xff, (chars.length >> 8) & 0xff];
					outputBytes.push(...(this.getEndianness() === "big" ? length.reverse() : length), ...chars);
					break;
				}
			}
		}
		return outputBytes;
	}
}
