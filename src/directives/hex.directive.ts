import type { Assembler } from "../assembler/polyasm";
import type { Lister } from "../helpers/lister.class";
import type { Logger } from "../helpers/logger.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class HexDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	constructor(
		private readonly logger: Logger,
		private readonly lister: Lister,
	) {}

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		const hexString = this.extractHexData(directive, assembler);

		try {
			const byteCount = hexString.replace(/\s/g, "").length / 2;
			assembler.currentPC += byteCount;

			this.lister.directive(directive, `<${byteCount} bytes>`);
		} catch (e) {
			this.logger.warn(`[PASS 1] Warning on line ${directive.line}: Could not calculate size of .HEX block. ${e}`);
		}
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		const hexString = this.extractHexData(directive, assembler);

		const cleanedString = hexString.replace(/\s/g, "");
		if (cleanedString.length % 2 !== 0) throw new Error("Hex data must have an even number of digits.");

		const bytes: number[] = [];
		for (let i = 0; i < cleanedString.length; i += 2) {
			const byteString = cleanedString.substring(i, i + 2);
			const byte = Number.parseInt(byteString, 16);
			if (Number.isNaN(byte)) throw new Error(`Invalid hexadecimal character sequence: "${byteString}"`);

			bytes.push(byte);
		}

		if (context.isAssembling && bytes.length > 0) context.writebytes(bytes);

		if (!context.isAssembling) assembler.currentPC += bytes.length;

		this.lister.directive(directive, `<${bytes.length} bytes>`);
	}

	/**
	 * Extracts the raw hexadecimal string from the source tokens,
	 * handling both inline `{...}` and block `.HEX...END` syntax.
	 * @returns A tuple of [hexDataString, endIndex].
	 */
	private extractHexData(directive: ScalarToken, assembler: Assembler) {
		const hexTokens = assembler.parser.getDirectiveBlockTokens(directive.value);

		// The lexer will tokenize '0E' as NUMBER '0' and IDENTIFIER 'E', and '60' as NUMBER '60'.
		// We must join their values back together to form a single string of hex digits,
		// while ignoring any comments that might be inside the block.
		const hexString = hexTokens?.map((t) => t.raw ?? t.value).join("");

		return hexString ?? "";
	}
}
