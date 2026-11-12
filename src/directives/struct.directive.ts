import type { ExpressionEvaluator } from "../assembler/expression";
import type { EvaluationContext } from "../assembler/expression.types";
import type { Assembler } from "../assembler/polyasm";
import { RelocValue } from "../assembler/reloc-value.class";
import { StructType } from "../assembler/struct-type.class";
import type { SymbolValue } from "../assembler/symbol.class";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { tokenText } from "../utils/token.utils";
import type { DirectiveContext, IDirective } from "./directive.interface";

/** The fields of a fixed size, by their directive. */
const FIXED_SIZES: Record<string, number> = { BYTE: 1, DB: 1, WORD: 2, DW: 2, LONG: 4, DL: 4 };
/** The fields of the size their operand gives. */
const RESERVE = new Set(["RES", "DS", "FILL"]);

const FIELD_KINDS = "a field is .byte, .word, .long or .res <count>";

/**
 * `.struct <name>` … `.end`: a type, its fields' offsets computed from their sizes. `Sprite.tile` is a field's offset,
 * `.size(Sprite)` its size; `player: .res Sprite` or `enemy = $0300 as Sprite` make symbols of that type (`player.tile`).
 */
export class StructDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: ILister,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		this.define(directive, context);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		this.define(directive, context);
	}

	private define(directive: ScalarToken, context: DirectiveContext) {
		const nameToken = this.structName(directive);
		const name = (nameToken.raw as string | undefined) ?? nameToken.value;
		const body = this.assembler.parser.getDirectiveBlockTokens(directive.value);
		const struct = this.build(name, body, context);

		const symbolTable = this.assembler.symbolTable;
		if (this.assembler.pass === 1)
			symbolTable.defineConstant(nameToken.value, struct, { filename: context.filename, line: nameToken.line, column: nameToken.column });
		else symbolTable.updateSymbol(nameToken.value, struct);

		this.lister.directive(directive, name);
	}

	/** The struct's name, on the directive's line: a word on the next line is the body's. */
	private structName(directive: ScalarToken): ScalarToken {
		const token = this.assembler.parser.peek();
		if (!token || token.type === "EOF" || token.line !== directive.line) throw AsmError.at("A struct needs a name.", directive);
		if (token.type !== "IDENTIFIER") throw AsmError.at("A struct needs a name.", token);
		this.assembler.parser.advance();
		const [extra] = this.assembler.parser.getInstructionTokens(directive);
		if (extra) throw AsmError.at(`Unexpected '${tokenText(extra)}' after the struct's name.`, extra);
		return token as ScalarToken;
	}

	/** The struct of the body's fields, one per line: its offsets one after the other, from 0. */
	private build(name: string, body: Token[], context: DirectiveContext): StructType {
		const fields: [string, number][] = [];
		const seen = new Set<string>();
		let offset = 0;

		for (const line of byLine(body)) {
			const field = this.field(line, context);
			if (field.name !== undefined) {
				if (seen.has(field.name)) throw AsmError.at(`Field '${field.name}' is defined twice in struct ${name}.`, line[0] as Token);
				seen.add(field.name);
				fields.push([field.name, offset]);
			}
			offset += field.size;
		}

		return new StructType(name, fields, offset);
	}

	/** A line of the body: an optional name, as written, and a directive giving its size. */
	private field(line: Token[], context: DirectiveContext): { name?: string; size: number } {
		const first = line[0] as Token;
		const hasName = first.type === "IDENTIFIER" || first.type === "LABEL";
		const name = hasName ? ((first.raw as string | undefined) ?? (first.value as string)) : undefined;
		const dot = line[hasName ? 1 : 0];
		const directive = line[hasName ? 2 : 1];

		if (!dot) throw AsmError.at(`The field '${name}' has no size: ${FIELD_KINDS}.`, first);
		if (dot.type !== "DOT" || directive?.type !== "IDENTIFIER") throw AsmError.at(`Unexpected '${tokenText(dot)}' in a struct: ${FIELD_KINDS}.`, dot);

		const kind = directive.value as string;
		const operand = line.slice(hasName ? 3 : 2);
		const written = `.${directive.raw ?? kind.toLowerCase()}`;

		const fixed = FIXED_SIZES[kind];
		if (fixed !== undefined) {
			const [extra] = operand;
			if (extra)
				throw AsmError.at(`${written} in a struct takes no operand, it is ${fixed} byte${fixed > 1 ? "s" : ""}: .res <count> reserves more.`, extra);
			return { name, size: fixed };
		}

		if (!RESERVE.has(kind)) throw AsmError.at(`${written} can't be in a struct: ${FIELD_KINDS}.`, directive);
		return { name, size: this.count(written, directive, operand, context) };
	}

	/** The byte count of a `.res` field: known where the struct is, as its offsets are. */
	private count(written: string, directive: Token, operand: Token[], context: DirectiveContext): number {
		if (operand.length === 0) throw AsmError.at(`${written} in a struct needs a count of bytes.`, directive);
		const comma = operand.find((token) => token.type === "COMMA");
		if (comma) throw AsmError.at(`${written} in a struct takes a count only: a field has no value.`, comma);

		const value = this.assembler.expressionEvaluator.evaluate(operand, { ...context, allowForwardRef: false });
		if (value instanceof StructType)
			throw AsmError.at(`A field can't be a struct yet: write ${written} .size(${StructType.nameOf(value)}) to reserve its bytes.`, operand[0] as Token);
		if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
			throw AsmError.at(`${written} count: ${value} isn't a whole number of bytes (0 or more).`, operand[0] as Token);
		return value;
	}
}

/** The tokens of each line, in order. */
function byLine(tokens: Token[]): Token[][] {
	const lines: Token[][] = [];
	let current: Token[] = [];
	for (const token of tokens) {
		if (token.type === "EOF") continue;
		if (current.length && (current[0] as Token).line !== token.line) {
			lines.push(current);
			current = [];
		}
		current.push(token);
	}
	if (current.length) lines.push(current);
	return lines;
}

/**
 * A value typed by a struct, `$0300 as Sprite` (`=`, `.equ`, `.let`): the value's tokens and the struct, which must be
 * defined before. Without `as`, the tokens as they are and no struct.
 */
export function readStructType(tokens: Token[], evaluator: ExpressionEvaluator, context: EvaluationContext): { valueTokens: Token[]; struct?: StructType } {
	const as = tokens[tokens.length - 2];
	const typeToken = tokens[tokens.length - 1];
	if (as?.type !== "IDENTIFIER" || as.value !== "AS" || typeToken?.type !== "IDENTIFIER") return { valueTokens: tokens };

	const valueTokens = tokens.slice(0, -2);
	if (valueTokens.length === 0) throw AsmError.at(`Missing the address before '${tokenText(as)}'.`, as);
	const struct = evaluator.evaluate([typeToken], { ...context, allowForwardRef: false });
	if (!(struct instanceof StructType)) throw AsmError.at(`'${tokenText(typeToken)}' is not a struct.`, typeToken);
	return { valueTokens, struct };
}

/** Checks that `value`, an instance of `struct`, is an address: a number, or relocatable. Not known yet in pass 1 (null) is fine. */
export function checkInstance(value: SymbolValue | null, struct: StructType, at: Token) {
	if (value === null || typeof value === "number" || (value instanceof RelocValue && value.byteShift === undefined)) return;
	const shown = value instanceof RelocValue ? `${value}` : JSON.stringify(value);
	throw AsmError.at(`An instance of ${StructType.nameOf(struct)} is an address: ${shown} isn't one.`, at);
}
