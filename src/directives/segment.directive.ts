import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

type SegmentDef = {
	start: number;
	end?: number;
	size?: number;
	pad?: number;
};

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
			if (tokens.length === 0) throw new Error(`ERROR on line ${directive.line}: .SEGMENT requires a name expression.`);
			name = this.runtime.evaluator.evaluate(tokens, context);
			if (typeof name !== "string") throw new Error(`ERROR on line ${directive.line}: .SEGMENT name must evaluate to a string.`);
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
			if (tokens.length === 0) throw new Error(`ERROR on line ${directive.line}: .SEGMENT requires a name expression.`);
			name = this.runtime.evaluator.evaluate(tokens, context);
			if (typeof name !== "string") throw new Error(`ERROR on line ${directive.line}: .SEGMENT name must evaluate to a string.`);
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
		const params = this.parseBlockParameters(context, directive.line);

		if (params.start === undefined || (params.end === undefined && params.size === undefined))
			throw new Error(`ERROR on line ${directive.line}: .SEGMENT definition requires 'start','end' or 'start','size' parameters.`);

		const start = params.start;
		const end = params.end !== undefined ? params.end : start + (params.size ?? 0) - 1;
		const pad = params.pad;

		const size = end - start + 1;
		if (size <= 0) throw new Error(`ERROR on line ${directive.line}: .SEGMENT 'end' address must be greater than or equal to 'start' address.`);

		this.runtime.linker.addSegment(name, start, size, pad);

		this.runtime.lister.directive(directive, `${name.padEnd(16)} { start: $${getHex(start)}, end: $${getHex(end)}, pad: $${getHex(pad ?? 0)} }`);
	}

	private parseBlockParameters(context: DirectiveContext, line: number | string): SegmentDef {
		const params: SegmentDef = { start: 0 };

		this.runtime.parser.advance();

		while (true) {
			const token = this.runtime.parser.next();
			if (!token || token.type === "RBRACE") break;
			if (token.type !== "LABEL") throw new Error(`.SEGMENT definition syntax error on line ${line}: key:value`);

			const key = token.value.toLowerCase();
			if (key !== "start" && key !== "end" && key !== "pad" && key !== "size")
				throw new Error(`.SEGMENT definition syntax error on line ${line}: unknown property ${key}`);

			const valueTokens = this.runtime.parser.getExpressionTokens();
			params[key] = this.runtime.evaluator.evaluateAsNumber(valueTokens, context);

			if (this.runtime.parser.peek()?.type === "COMMA") this.runtime.parser.advance();
		}

		return params;
	}
}
