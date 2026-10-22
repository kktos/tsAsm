import type { Assembler } from "../assembler/polyasm";
import type { Logger } from "../helpers/logger.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class IncbinDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly logger: Logger,
	) {}

	public handlePassOne(_directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.assembler.parser.getInstructionTokens();
		if (expressionTokens.length === 0) throw new Error(".INCBIN requires a string argument.");

		// 2. Resolve the array from the symbol table
		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(".INCBIN requires a string argument.");

		// Pass 1 knows the file name: a file that can't be read is reported now, not after a pass with a wrong size.
		const rawBytes = this.readFile(filename);
		context.PC.value += rawBytes.length;
		this.logger.log(`[PASS 1] Reserved ${rawBytes.length} bytes for binary file: ${filename}`);

		return undefined;
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.assembler.parser.getInstructionTokens();
		if (expressionTokens.length === 0) throw new Error(".INCBIN requires a string argument.");

		// 2. Resolve the array from the symbol table
		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(".INCBIN requires a string argument.");

		const rawBytes = this.readFile(filename);

		context.emitbytes(rawBytes);
		// this.assembler.currentPC is advanced by writeBytes
		// this.assembler.symbolTable.lookupAndUpdateSymbol("*", this.assembler.currentPC);

		const bytesStr =
			rawBytes
				.slice(0, 4)
				.map((b) => b.toString(16).padStart(2, "0").toUpperCase())
				.join(" ") + (rawBytes.length > 4 ? "..." : "");

		const addressHex = getHex(context.PC.value, 4);
		this.logger.log(`[PASS 2] $${addressHex}: ${bytesStr.padEnd(8)} | Line ${directive.line}: .INCBIN "${filename}" (${rawBytes.length} bytes)`);

		return undefined;
	}

	private readFile(filename: string): number[] {
		try {
			return this.assembler.fileHandler.readBinaryFile(filename);
		} catch (e) {
			throw new Error(`Can't include binary file '${filename}': ${e instanceof Error ? e.message : e}`);
		}
	}
}
