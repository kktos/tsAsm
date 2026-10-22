import type { Parser } from "../assembler/parser.class";
import type { Assembler } from "../assembler/polyasm";
import type { ILister } from "../helpers/lister.class";
import type { Logger } from "../helpers/logger.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

/**
 * Reads the .HEX data right after the directive's name, as raw text so digits like '0A' or '0B01' aren't lexed as numbers:
 * the rest of the line, a '{ ... }' block, or, when the line is blank, the lines up to '.END'.
 * Pass 2, macros and blocks replay the RAW_TEXT token read the first time.
 */
function readHexData(parser: Parser): Token {
	if (!parser.isAtUnlexedSource()) {
		const token = parser.peek();
		if (token?.type !== "RAW_TEXT") throw new Error("Internal error: the .HEX data was read as tokens.");
		parser.advance();
		return token;
	}
	const token = parser.lexer.isRestOfLineBlank() ? parser.next({ endMarker: ".END", blockName: "HEX" }) : parser.next({ rawInline: true, blockName: "HEX" });
	return token as Token;
}

export class HexDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = true;

	constructor(
		private readonly assembler: Assembler,
		private readonly logger: Logger,
		private readonly lister: ILister,
	) {}

	getRawBlock(parser: Parser, _directive: Token): Token[] {
		return [readHexData(parser)];
	}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		const hexString = this.extractHexData();

		try {
			const byteCount = hexString.replace(/\s/g, "").length / 2;
			context.PC.value += byteCount;

			this.lister.directive(directive, `<${byteCount} bytes>`);
		} catch (e) {
			this.logger.warn(`[PASS 1] Warning on line ${directive.line}: Could not calculate size of .HEX block. ${e}`);
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const hexString = this.extractHexData();

		const cleanedString = hexString.replace(/\s/g, "");
		if (cleanedString.length % 2 !== 0) throw new Error("Hex data must have an even number of digits.");

		const bytes: number[] = [];
		for (let i = 0; i < cleanedString.length; i += 2) {
			const byteString = cleanedString.substring(i, i + 2);
			const byte = Number.parseInt(byteString, 16);
			if (Number.isNaN(byte)) throw new Error(`Invalid hexadecimal character sequence: "${byteString}"`);

			bytes.push(byte);
		}

		if (bytes.length > 0) context.emitbytes(bytes);

		this.lister.directive(directive, `<${bytes.length} bytes>`);
	}

	/** Returns the .HEX data as text, without its comments. */
	private extractHexData() {
		const text = readHexData(this.assembler.parser).value as string;
		if (text.includes('"') || text.includes("'")) throw new Error(".HEX does not accept strings; write the hex digits without quotes.");

		const commentChar = this.assembler.parser.lexer.commentChar;
		return text
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.split("\n")
			.map((line) => {
				const comment = [line.indexOf(commentChar), line.indexOf("//")].filter((i) => i >= 0);
				return comment.length ? line.slice(0, Math.min(...comment)) : line;
			})
			.join("\n");
	}
}
