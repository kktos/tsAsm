import { notRelocatable, RelocValue } from "../assembler/reloc-value.class";
import { type StructField, StructType } from "../assembler/struct-type.class";
import type { SymbolValue } from "../assembler/symbol.class";
import type { Endianness } from "../cpu/cpuhandler.interface";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";
import { assertFitsInBytes } from "../utils/number.utils";
import { stringToBytes } from "../utils/string.utils";
import { findTopLevelComma, tokenText } from "../utils/token.utils";
import { elementBytes, relocatableElement } from "./data-element";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

/** The arguments of a `.res`: its count, its filler after a comma, and the values of its struct's fields in `{ }` after the count. */
type FillArguments = { countTokens: Token[]; fillerTokens: Token[] | null; values?: { brace: Token; tokens: Token[] } };

/** The most bytes one `.fill` or `.align` writes: 1 MB. The bytes are built in memory, and hundreds of MB crashed Node. */
export const MAX_FILL = 0x100000;

export class FillDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly runtime: DirectiveRuntime,
		/** The current CPU's byte order, for the values of a struct's fields (.cpu can change it). */
		private readonly getEndianness: () => Endianness,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		const { countTokens } = this.readArguments(directive);

		if (countTokens.length > 0) {
			let byteCount: number | null;
			try {
				byteCount = this.count(directive, countTokens, context).count;
			} catch (e) {
				// Error evaluating in pass one, but we must continue. Assume 0 size.
				this.runtime.warn(`Could not evaluate the .FILL count: ${e instanceof Error ? e.message : e}`);
				return;
			}
			// A symbol defined later: assume 0 size, pass 2 will know.
			if (byteCount === null) return;
			this.assertValidCount(byteCount, directive);

			context.PC.value += byteCount;
			this.runtime.lister.directive(directive, `<${byteCount} bytes>`);
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		const { countTokens, fillerTokens, values } = this.readArguments(directive);
		const { count, struct } = this.count(directive, countTokens, context);
		this.assertValidCount(count, directive);

		// No comma, no filler: 0. A comma with nothing after it is `Missing expression.`, as `.db 1,`.
		const fillerValue = fillerTokens ? this.runtime.evaluator.evaluateAsNumber(fillerTokens, context) : 0;
		assertFitsInBytes(fillerValue, 1, `.${directive.value} value:`);

		if (values && !struct)
			throw AsmError.at(`Values in { } are a struct's fields: .${directive.value} ${tokensText(countTokens)} reserves no struct.`, values.brace);

		if (count > 0) {
			// Ensure filler value is a single byte
			const byteValue = fillerValue & 0xff;
			const bytes = Array.from({ length: count }, () => byteValue);
			// Emitting moves the PC past the bytes: list them where they start.
			const addr = context.PC.value;
			if (values && struct) this.writeFields(bytes, struct, values.tokens, { ...context, addr });
			context.emitbytes(bytes);

			this.runtime.lister.directiveWithBytes({
				addr,
				bytes,
				pragma: directive,
				params: [count as SymbolValue, fillerValue as SymbolValue] as SymbolValue[][],
				hasText: false,
			});
		}
	}

	/**
	 * The byte count: a number, or a struct, its size, making the label on the line an instance of it (`player: .res Sprite`).
	 * Null in pass 1 when it's defined later.
	 */
	private count(directive: ScalarToken, countTokens: Token[], context: DirectiveContext): { count: number; struct?: StructType } {
		const value = this.runtime.evaluator.evaluate(countTokens, context);
		if (!(value instanceof StructType)) return { count: this.runtime.evaluator.asNumber(notRelocatable(value)) };
		const label = this.runtime.lineLabel(directive);
		if (label) this.runtime.symbolTable.setStruct(label, value);
		return { count: StructType.sizeOf(value), struct: value };
	}

	/**
	 * Writes the values of `{ x: 10, name: "HERO" }` into `bytes`, the struct's, at their fields' offsets: a number field
	 * takes a number, in the CPU's byte order, a `.res` field a string or an array of bytes, the filler after them.
	 */
	private writeFields(bytes: number[], struct: StructType, tokens: Token[], context: DirectiveContext & { addr: number }) {
		const given = new Set<string>();
		for (const { nameToken, name, valueTokens } of fieldValues(tokens)) {
			let field: StructField;
			try {
				field = StructType.fieldOf(struct, name);
			} catch (e) {
				throw AsmError.at((e as Error).message, nameToken);
			}
			if (given.has(name)) throw AsmError.at(`Field '${name}' is given twice.`, nameToken);
			given.add(name);

			const at = valueTokens[0] as Token;
			let fieldBytes: number[];
			try {
				const value = this.runtime.evaluator.evaluate(valueTokens, context);
				fieldBytes = this.fieldBytes(struct, field, value, at, context.addr + field.offset);
			} catch (e) {
				// A value that doesn't fit, or isn't a number: located at it, not at the statement.
				throw e instanceof AsmError || !(e instanceof Error) ? e : AsmError.at(e.message, at);
			}
			bytes.splice(field.offset, fieldBytes.length, ...fieldBytes);
		}
	}

	/** The bytes of `value` in `field`, written at `addr`: a relocatable address in a number field gets its fixup. */
	private fieldBytes(struct: StructType, field: StructField, value: SymbolValue, at: Token, addr: number): number[] {
		const description = `Field '${field.name}' of ${StructType.nameOf(struct)}:`;
		const endianness = this.getEndianness();

		if (field.kind === "number") {
			if (value instanceof RelocValue) return relocatableElement(this.runtime.linker, value, { size: field.size, endianness, addr }, description, at);
			const number = this.runtime.evaluator.asNumber(value) as number;
			assertFitsInBytes(number, field.size, description);
			return elementBytes(number, field.size, endianness);
		}

		const fieldBytes = this.bytesValue(value, description, field.size, at);
		if (fieldBytes.length > field.size) throw AsmError.at(`${description} ${fieldBytes.length} bytes don't fit in its ${field.size}.`, at);
		return fieldBytes;
	}

	/** A `.res` field's value: a string, its characters, or an array of bytes. */
	private bytesValue(value: SymbolValue, description: string, size: number, at: Token): number[] {
		if (typeof value === "string") return stringToBytes(value, description);
		if (!Array.isArray(value))
			throw AsmError.at(`${description} it is ${size} bytes, given by a string or an array of bytes: ${shownValue(value)} is neither.`, at);
		return value.map((element) => {
			const byte = this.runtime.evaluator.asNumber(notRelocatable(element)) as number;
			assertFitsInBytes(byte, 1, description);
			return byte;
		});
	}

	private assertValidCount(count: number | null, directive: ScalarToken) {
		if (!Number.isInteger(count) || (count as number) < 0)
			throw new Error(`.${directive.value} count: ${count} isn't a whole number of bytes (0 or more).`);
		if ((count as number) > MAX_FILL)
			throw new Error(
				`.${directive.value} count: $${getHex(count as number, 1)} is more than $${getHex(MAX_FILL, 1)} bytes (1 MB): split it into several .FILL.`,
			);
	}

	/**
	 * The count, then the values of the struct's fields in `{ }`, on the line (`.res Sprite { x: 10 }`), then the filler
	 * after a comma: `.res 4, $FF`, `.res Sprite { x: 10 }, $FF`.
	 */
	private readArguments(directive: ScalarToken): FillArguments {
		const parser = this.runtime.parser;
		const tokens = parser.getInstructionTokens(directive);
		const commaIndex = findTopLevelComma(tokens);
		const countTokens = commaIndex === -1 ? tokens : tokens.slice(0, commaIndex);
		const fillerTokens = commaIndex === -1 ? null : tokens.slice(commaIndex + 1);

		const brace = parser.peek();
		if (brace?.type !== "LBRACE" || brace.line !== directive.line) return { countTokens, fillerTokens };
		if (fillerTokens) throw AsmError.at(`The fields' values come before the filler: .${directive.value} <struct> { … }, <filler>.`, brace);
		parser.advance();

		const valueTokens: Token[] = [];
		while (true) {
			const token = parser.peek();
			if (!token || token.type === "EOF" || token.line !== directive.line)
				throw AsmError.at("'{' isn't closed on its line: the fields' values are on the line of the struct.", brace);
			parser.advance();
			if (token.type === "RBRACE") break;
			if (token.type === "LBRACE") throw AsmError.at("Unexpected '{' in the fields' values.", token);
			valueTokens.push(token);
		}

		const after = parser.getInstructionTokens(directive);
		const next = parser.peek();
		const extra = after[0]?.type === "COMMA" ? undefined : (after[0] ?? (next?.line === directive.line && next.type !== "EOF" ? next : undefined));
		if (extra) throw AsmError.at(`Unexpected '${tokenText(extra)}' after the fields' values.`, extra);
		if (next?.line === directive.line && next.type === "LBRACE") throw AsmError.at(`Unexpected '${tokenText(next)}' after the filler.`, next);

		return { countTokens, fillerTokens: after.length ? after.slice(1) : null, values: { brace, tokens: valueTokens } };
	}
}

/** The fields' values in `{ }`, `name: value` separated by commas. */
function fieldValues(tokens: Token[]): { nameToken: Token; name: string; valueTokens: Token[] }[] {
	const entries: { nameToken: Token; name: string; valueTokens: Token[] }[] = [];
	let rest = tokens;
	while (rest.length) {
		const comma = findTopLevelComma(rest);
		const entry = comma === -1 ? rest : rest.slice(0, comma);
		const nameToken = entry[0];
		if (!nameToken) throw AsmError.at("Missing a field's value before ','.", rest[0] as Token);
		if (nameToken.type !== "LABEL") throw AsmError.at(`Expected a field's name and a colon, as 'x: 10', at '${tokenText(nameToken)}'.`, nameToken);
		const name = (nameToken.raw as string | undefined) ?? (nameToken.value as string);
		const valueTokens = entry.slice(1);
		if (valueTokens.length === 0) throw AsmError.at(`Missing the value of field '${name}'.`, nameToken);
		entries.push({ nameToken, name, valueTokens });
		if (comma === -1) break;
		rest = rest.slice(comma + 1);
		if (rest.length === 0) throw AsmError.at("Missing a field's value after ','.", tokens[tokens.length - 1] as Token);
	}
	return entries;
}

/** A value, for a message: a relocatable one as `CODE+$0002`, an object as JSON. */
function shownValue(value: SymbolValue): string {
	return value instanceof RelocValue ? `${value}` : JSON.stringify(value);
}

/** The tokens as written, for a message. */
function tokensText(tokens: Token[]): string {
	return tokens.map(tokenText).join(" ");
}
