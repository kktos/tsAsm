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

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.assembler.parser.getInstructionTokens();
		if (expressionTokens.length === 0) throw new Error(`[PASS 1] ERROR: .INCBIN requires a string argument on line ${directive.line}.`);

		// 2. Resolve the array from the symbol table
		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(`[PASS 1] ERROR: .INCBIN requires a string argument on line ${directive.line}.`);

		try {
			const rawBytes = this.assembler.fileHandler.readBinaryFile(filename);
			context.PC.value += rawBytes.length;
			this.logger.log(`[PASS 1] Reserved ${rawBytes.length} bytes for binary file: ${filename}`);
		} catch (e) {
			this.logger.error(`[PASS 1] ERROR reading binary file ${filename} for size calculation: ${e}`);
		}

		return undefined;
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.assembler.parser.getInstructionTokens();
		if (expressionTokens.length === 0) throw new Error(`[PASS 1] ERROR: .INCBIN requires a string argument on line ${directive.line}.`);

		// 2. Resolve the array from the symbol table
		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(`[PASS 2] ERROR: .INCBIN requires a string argument on line ${directive.line}.`);

		try {
			const rawBytes = this.assembler.fileHandler.readBinaryFile(filename);

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
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			this.logger.error(`\n[PASS 2] FATAL ERROR on line ${directive.line}: Could not include binary file ${filename}. Error: ${errorMessage}`);
			throw new Error(`Assembly failed on line ${directive.line}: Binary include failed.`);
		}

		return undefined;
	}
}
