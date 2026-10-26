import type { SymbolValue } from "../assembler/symbol.class";
import type { Endianness } from "../cpu/cpuhandler.interface";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { assertFitsInBytes } from "../utils/number.utils";
import { stringToBytes } from "../utils/string.utils";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";
import { readListElement } from "./list-element";

export class DataDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly runtime: DirectiveRuntime,
		private readonly bytesPerElement: number,
		/** The current CPU's byte order, read when the bytes are written (.cpu can change it). */
		private readonly getEndianness: () => Endianness,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		const byteCount = this.calculateDirectiveSize(directive, context);
		context.PC.value += byteCount;
		this.runtime.lister.directive(directive, `<${byteCount} bytes>`);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const bytes = this.encodeDataDirective(directive, context);
		context.emitbytes(bytes);
	}

	private calculateDirectiveSize(directive: ScalarToken, context: DirectiveContext): number {
		let totalSize = 0;

		while (true) {
			const { tokens, values } = readListElement(this.runtime, directive, context);
			if (tokens.length === 0) break;

			for (const value of values) {
				switch (typeof value) {
					case "object": {
						// null: not known yet, a number or a string later
						if (value !== null) throw this.notData(directive, value, tokens);
						totalSize += this.bytesPerElement;
						break;
					}
					case "string": {
						totalSize += stringToBytes(value, `.${directive.value} value:`).length;
						break;
					}
					case "number": {
						totalSize += this.bytesPerElement;
						break;
					}
					default:
						throw new Error(`Unexpected value type ${typeof value}.`);
				}
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
			const { tokens, values } = readListElement(this.runtime, directive, context);
			if (tokens.length === 0) break;

			for (const value of values) {
				switch (typeof value) {
					case "string": {
						outputBytes.push(...stringToBytes(value, `.${directive.value} value:`));
						params.push(value);
						hasText = true;
						break;
					}
					case "number": {
						assertFitsInBytes(value, this.bytesPerElement, `.${directive.value} value:`);
						const bytes = Array.from({ length: this.bytesPerElement }, (_, i) => (value >> (i * 8)) & 0xff);
						outputBytes.push(...(this.getEndianness() === "big" ? bytes.reverse() : bytes));
						params.push(value);
						break;
					}
					case "object":
						// An array defined after the directive was null in pass 1, counted as one element.
						if (value !== null) throw this.notData(directive, value, tokens);
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

	/** Only numbers and strings are data: an array or an object, emitted whole, would hide a missing index or field. */
	private notData(directive: ScalarToken, value: SymbolValue, exprTokens: Token[]) {
		const hint = Array.isArray(value)
			? "an array can't be emitted as is: index it to emit one of its elements, or spread it (...) to emit them all"
			: "an object can't be emitted as is: use one of its fields";
		return AsmError.at(`.${directive.value} value: ${hint}.`, exprTokens[0] as Token);
	}
}
