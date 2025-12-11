import type { Assembler } from "../assembler/polyasm";
import type { Logger } from "../helpers/logger.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class OptionDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly logger: Logger,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		this.setOption(directive, context);
	}

	public handlePassTwo(_directive: ScalarToken, _context: DirectiveContext) {}

	private setOption(directive: ScalarToken, context: DirectiveContext): void {
		const argTokens = this.assembler.parser.getInstructionTokens();

		if (argTokens.length < 2) throw new Error(`Invalid .OPTION syntax on line ${directive.line}. Expected: .OPTION <name> <value>`);

		if (argTokens[0]?.type !== "IDENTIFIER") throw new Error(`Option name must be an identifier on line ${directive.line}.`);

		const optionName = argTokens[0].value.toLowerCase();
		const optionValue = this.assembler.expressionEvaluator.evaluate(argTokens.slice(1), context);

		switch (optionName) {
			case "local_label_char":
				if (typeof optionValue !== "string" || optionValue.length !== 1)
					throw new Error(`Value for 'local_label_char' must be a single character string on line ${directive.line}.`);

				this.assembler.setOption("local_label_char", optionValue);
				break;
			default:
				this.logger.warn(`[OPTION] Unknown option '${optionName}' on line ${directive.line}.`);
		}
	}
}
