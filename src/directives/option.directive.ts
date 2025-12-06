import type { ScalarToken } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class OptionDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		this.setOption(directive, assembler, context);
	}

	public handlePassTwo(_directive: ScalarToken, _assembler: Assembler, _context: DirectiveContext) {}

	private setOption(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		const argTokens = assembler.parser.getInstructionTokens();

		if (argTokens.length < 2) throw new Error(`Invalid .OPTION syntax on line ${directive.line}. Expected: .OPTION <name> <value>`);

		if (argTokens[0]?.type !== "IDENTIFIER") throw new Error(`Option name must be an identifier on line ${directive.line}.`);

		const optionName = argTokens[0].value.toLowerCase();
		const optionValue = assembler.expressionEvaluator.evaluate(argTokens.slice(1), context);

		switch (optionName) {
			case "local_label_char":
				if (typeof optionValue !== "string" || optionValue.length !== 1)
					throw new Error(`Value for 'local_label_char' must be a single character string on line ${directive.line}.`);

				assembler.setOption("local_label_char", optionValue);
				break;
			default:
				assembler.logger.warn(`[OPTION] Unknown option '${optionName}' on line ${directive.line}.`);
		}
	}
}
