import type { Parser } from "../assembler/parser.class";
import type { Assembler } from "../assembler/polyasm";
import handlers from "../cpu";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

/**
 * Reads a name starting with a digit, alone on the line (`6502`, `65C02`), as raw text: lexed, it would be a number or an error.
 * Pass 2, macros and blocks replay the RAW_TEXT token read the first time. Anything else is left for the lexer.
 */
function readCpuName(parser: Parser): Token | undefined {
	if (!parser.isAtUnlexedSource()) {
		const token = parser.peek();
		if (token?.type !== "RAW_TEXT") return undefined;
		parser.advance();
		return token;
	}
	if (!/^[0-9]\w*$/.test(parser.lexer.restOfLine())) return undefined;
	return parser.next({ rawInline: true, blockName: "CPU" }) as Token;
}

export class CpuDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = true;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: ILister,
	) {}

	getRawBlock(parser: Parser, _directive: Token): Token[] {
		const token = readCpuName(parser);
		return token ? [token] : [];
	}

	/** A word alone is the CPU's name, `65C02` or `rv32i`; anything else is an expression giving it, `"65C02"` or `(CPU)`. */
	private readName(directive: ScalarToken, context: DirectiveContext): string {
		const rawName = readCpuName(this.assembler.parser);
		if (rawName) return String(rawName.value);

		const tokens = this.assembler.parser.getInstructionTokens();
		if (tokens.length === 1 && tokens[0]?.type === "IDENTIFIER") return String(tokens[0].value);

		const cpuName = this.assembler.expressionEvaluator.evaluate(tokens, context);
		if (typeof cpuName !== "string") throw new Error(`.${directive.value} name must evaluate to a string.`);
		return cpuName;
	}

	private setCpu(directive: ScalarToken, context: DirectiveContext) {
		const cpuName = this.readName(directive, context);

		const upperCpuName = cpuName.toUpperCase();
		const handlerClass = handlers[upperCpuName];

		if (!handlerClass) throw new Error(`Unknown CPU name '${cpuName}'.`);
		if (this.assembler.getCPUHandler().cpuType !== upperCpuName) this.assembler.setCPUHandler(new handlerClass());

		this.lister.directive(directive, cpuName);
	}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		this.setCpu(directive, context);
	}
	public handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		this.setCpu(directive, context);
	}
}
