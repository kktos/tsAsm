import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";
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
		const { params, keys } = this.parseBlockParameters(context);
		const pad = params.pad;

		// A relocatable segment has no address until it's loaded: it starts at 0, and grows without a size.
		if (params.relocatable) {
			if (keys.start) throw AsmError.at("A relocatable segment has no 'start': its address is only known when it's loaded.", keys.start);
			if (keys.end) throw AsmError.at("A relocatable segment has no 'end': give its 'size', or none for a segment that grows.", keys.end);

			const size = params.size ?? 0;
			this.runtime.linker.addSegment(name, 0, size, pad, size === 0, true);

			this.runtime.lister.directive(directive, `${name.padEnd(16)} { relocatable, size: $${getHex(size)}, pad: $${getHex(pad ?? 0)} }`);
			return;
		}

		if (params.start === undefined || (params.end === undefined && params.size === undefined))
			throw new Error(".SEGMENT definition requires 'start','end' or 'start','size' parameters.");

		const start = params.start;
		const end = params.end !== undefined ? params.end : start + (params.size ?? 0) - 1;

		const size = end - start + 1;
		if (size < 0) throw new Error(".SEGMENT 'end' address must be greater than or equal to 'start' address.");

		this.runtime.linker.addSegment(name, start, size, pad, size === 0);

		this.runtime.lister.directive(directive, `${name.padEnd(16)} { start: $${getHex(start)}, end: $${getHex(end)}, pad: $${getHex(pad ?? 0)} }`);
	}

	/** The definition's values, and the token of each key given. */
	private parseBlockParameters(context: DirectiveContext) {
		const params: SegmentDef = {};
		const keys: Partial<Record<SegmentKey, Token>> = {};

		this.runtime.parser.advance();

		while (true) {
			const token = this.runtime.parser.next();
			if (!token || token.type === "RBRACE") break;
			if (token.type !== "LABEL") throw AsmError.at(`Expected 'key: value' in the .SEGMENT definition, got '${token.raw ?? token.value}'.`, token);

			const key = SEGMENT_KEYS[token.value.toLowerCase()];
			if (!key) throw AsmError.at(`Unknown .SEGMENT property '${token.raw ?? token.value}': expected start, end, size, pad or relocatable.`, token);

			const valueTokens = this.runtime.parser.getExpressionTokens();
			if (key === "relocatable") {
				if (keys.relocatable) throw AsmError.at("The .SEGMENT definition gives 'relocatable' twice ('reloc' is the same property).", token);
				params.relocatable = this.parseBoolean(token, valueTokens);
			} else params[key] = this.runtime.evaluator.evaluateAsNumber(valueTokens, context);
			keys[key] = token;

			if (this.runtime.parser.peek()?.type === "COMMA") this.runtime.parser.advance();
		}

		return { params, keys };
	}

	/** `true` or `false`, a word alone in any case. */
	private parseBoolean(key: Token, valueTokens: Token[]) {
		const word = valueTokens.length === 1 && valueTokens[0]?.type === "IDENTIFIER" ? String(valueTokens[0].value).toLowerCase() : undefined;
		if (word === "true") return true;
		if (word === "false") return false;
		throw AsmError.at(`.SEGMENT property '${key.raw ?? key.value}' must be true or false.`, valueTokens[0] ?? key);
	}
}
