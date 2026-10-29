import { RelocValue } from "../assembler/reloc-value.class";
import type { SymbolValue } from "../assembler/symbol.class";
import type { SegmentAttributes } from "../linker/linker.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";
import { undefinedSymbolName } from "../utils/symbol.utils";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

type SegmentDef = {
	start?: number;
	end?: number;
	size?: number;
	pad?: number;
	relocatable?: boolean;
};

type SegmentKey = keyof SegmentDef;

/** `reloc` is short for `relocatable`. */
const SEGMENT_KEYS: Record<string, SegmentKey> = { start: "start", end: "end", size: "size", pad: "pad", reloc: "relocatable", relocatable: "relocatable" };

export class SegmentDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		let name: SymbolValue;

		const token = this.runtime.parser.peek();
		if (token?.type === "IDENTIFIER") {
			name = token.value;
			this.runtime.parser.advance();
		} else {
			const tokens = this.runtime.parser.getInstructionTokens();
			if (tokens.length === 0) throw new Error(".SEGMENT requires a name expression.");
			name = this.runtime.evaluator.evaluate(tokens, context);
			if (typeof name !== "string") throw new Error(".SEGMENT name must evaluate to a string.");
		}

		if (this.runtime.parser.peek()?.type === "LBRACE") {
			this.defineSegment(name, directive, context);
			return;
		}

		this.runtime.linker.useSegment(name);
		this.runtime.lister.directive(directive, name, `ORG $${getHex(context.PC.value)}`);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		let name: SymbolValue;

		const token = this.runtime.parser.peek();
		if (token?.type === "IDENTIFIER") {
			name = token.value;
			this.runtime.parser.advance();
		} else {
			const tokens = this.runtime.parser.getInstructionTokens();
			if (tokens.length === 0) throw new Error(".SEGMENT requires a name expression.");
			name = this.runtime.evaluator.evaluate(tokens, context);
			if (typeof name !== "string") throw new Error(".SEGMENT name must evaluate to a string.");
		}

		// If it was a definition, the segment was already added in pass one.
		if (this.runtime.parser.peek()?.type === "LBRACE") {
			this.runtime.parser.getDirectiveBlockTokens("");
			return;
		}

		this.runtime.linker.useSegment(name);
		this.runtime.lister.directive(directive, name);
	}

	private defineSegment(name: string, directive: ScalarToken, context: DirectiveContext) {
		const { params, keys, attrs } = this.parseBlockParameters(context);
		const pad = params.pad;

		// A relocatable segment has no address until it's loaded: it starts at 0, and grows without a size.
		if (params.relocatable) {
			if (keys.start) throw AsmError.at("A relocatable segment has no 'start': its address is only known when it's loaded.", keys.start);
			if (keys.end) throw AsmError.at("A relocatable segment has no 'end': give its 'size', or none for a segment that grows.", keys.end);

			const size = params.size ?? 0;
			this.runtime.linker.addSegment(name, { size, padValue: pad, resizable: size === 0, relocatable: true, attrs });

			this.runtime.lister.directive(
				directive,
				`${name.padEnd(16)} { relocatable, size: $${getHex(size)}, pad: $${getHex(pad ?? 0)}${listAttributes(attrs)} }`,
			);
			return;
		}

		if (params.start === undefined || (params.end === undefined && params.size === undefined))
			throw new Error(".SEGMENT definition requires 'start','end' or 'start','size' parameters.");

		const start = params.start;
		const end = params.end !== undefined ? params.end : start + (params.size ?? 0) - 1;

		const size = end - start + 1;
		if (size < 0) throw new Error(".SEGMENT 'end' address must be greater than or equal to 'start' address.");

		this.runtime.linker.addSegment(name, { start, size, padValue: pad, resizable: size === 0, attrs });

		this.runtime.lister.directive(
			directive,
			`${name.padEnd(16)} { start: $${getHex(start)}, end: $${getHex(end)}, pad: $${getHex(pad ?? 0)}${listAttributes(attrs)} }`,
		);
	}

	/** The definition's values, the token of each key given, and its attributes: any other key, for the linker script. */
	private parseBlockParameters(context: DirectiveContext) {
		const params: SegmentDef = {};
		const keys: Partial<Record<SegmentKey, Token>> = {};
		const attrs: SegmentAttributes = {};

		this.runtime.parser.advance();

		while (true) {
			const token = this.runtime.parser.next();
			if (!token || token.type === "RBRACE") break;
			if (token.type !== "LABEL") throw AsmError.at(`Expected 'key: value' in the .SEGMENT definition, got '${token.raw ?? token.value}'.`, token);

			const valueTokens = this.runtime.parser.getExpressionTokens();
			const key = SEGMENT_KEYS[token.value.toLowerCase()];
			if (!key) {
				this.parseAttribute(attrs, token, valueTokens, context);
				if (this.runtime.parser.peek()?.type === "COMMA") this.runtime.parser.advance();
				continue;
			}

			if (key === "relocatable") {
				if (keys.relocatable) throw AsmError.at("The .SEGMENT definition gives 'relocatable' twice ('reloc' is the same property).", token);
				params.relocatable = this.parseBoolean(token, valueTokens);
			} else params[key] = this.runtime.evaluator.evaluateAsNumber(valueTokens, context);
			keys[key] = token;

			if (this.runtime.parser.peek()?.type === "COMMA") this.runtime.parser.advance();
		}

		return { params, keys, attrs };
	}

	/** An attribute: its key in lowercase, its value a number or a string, which the assembler never reads. */
	private parseAttribute(attrs: SegmentAttributes, key: Token, valueTokens: Token[], context: DirectiveContext) {
		const name = String(key.value).toLowerCase();
		if (name in attrs) throw AsmError.at(`The .SEGMENT definition gives the attribute '${name}' twice.`, key);

		const value = this.runtime.evaluator.evaluate(valueTokens, context);
		if (value === null)
			throw AsmError.at(
				`.SEGMENT: ${undefinedSymbolName(valueTokens, context, this.runtime.symbolTable)} must be defined before it is used here (the attribute '${name}' is read where the segment is defined).`,
				valueTokens[0] ?? key,
			);
		if (value instanceof RelocValue)
			throw AsmError.at(`.SEGMENT attribute '${name}': ${value} is relocatable, and an attribute is a number or a string.`, valueTokens[0] ?? key);
		if (typeof value !== "number" && typeof value !== "string")
			throw AsmError.at(`.SEGMENT attribute '${name}' must be a number or a string.`, valueTokens[0] ?? key);
		attrs[name] = value;
	}

	/** `true` or `false`, a word alone in any case. */
	private parseBoolean(key: Token, valueTokens: Token[]) {
		const word = valueTokens.length === 1 && valueTokens[0]?.type === "IDENTIFIER" ? String(valueTokens[0].value).toLowerCase() : undefined;
		if (word === "true") return true;
		if (word === "false") return false;
		throw AsmError.at(`.SEGMENT property '${key.raw ?? key.value}' must be true or false.`, valueTokens[0] ?? key);
	}
}

/** The attributes as the listing writes them, after the segment's bounds. */
function listAttributes(attrs: SegmentAttributes) {
	return Object.entries(attrs)
		.map(([name, value]) => `, ${name}: ${typeof value === "number" ? `$${getHex(value)}` : JSON.stringify(value)}`)
		.join("");
}
