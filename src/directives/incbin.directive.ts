import type { Assembler } from "../assembler/polyasm";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class IncbinDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: ILister,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.assembler.parser.getInstructionTokens();
		if (expressionTokens.length === 0) throw new Error(".INCBIN requires a string argument.");

		// 2. Resolve the array from the symbol table
		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(".INCBIN requires a string argument.");

		// Pass 1 knows the file name: a file that can't be read is reported now, not after a pass with a wrong size.
		const rawBytes = this.readFile(filename);
		context.PC.value += rawBytes.length;
		this.lister.directive(directive, filename, `<${rawBytes.length} bytes>`);

		return undefined;
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const expressionTokens = this.assembler.parser.getInstructionTokens();
		if (expressionTokens.length === 0) throw new Error(".INCBIN requires a string argument.");

		// 2. Resolve the array from the symbol table
		const filename = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
		if (typeof filename !== "string") throw new Error(".INCBIN requires a string argument.");

		const rawBytes = this.readFile(filename);

		this.lister.bytes({ addr: context.PC.value, bytes: rawBytes, text: `.${directive.value.toLowerCase()} "${filename}"` });

		context.emitbytes(rawBytes);

		return undefined;
	}

	private readFile(filename: string): number[] {
		try {
			// Relative to the file being assembled, as an .include: in a macro body, the file the macro is called from.
			return this.assembler.fileHandler.readBinaryFile(filename, this.assembler.streamManager.currentFilepath);
		} catch (e) {
			throw new Error(`Can't include binary file '${filename}': ${e instanceof Error ? e.message : e}`);
		}
	}
}
