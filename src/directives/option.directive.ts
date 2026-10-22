import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class OptionDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly assembler: Assembler) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		this.setOption(directive, context);
	}

	public handlePassTwo(_directive: ScalarToken, _context: DirectiveContext) {
		// The option is applied in pass 1; only skip its arguments, so they aren't parsed as a statement.
		this.assembler.parser.getInstructionTokens();
	}

	private setOption(_directive: ScalarToken, context: DirectiveContext): void {
		const argTokens = this.assembler.parser.getInstructionTokens();

		if (argTokens.length < 2) throw new Error("Invalid .OPTION syntax. Expected: .OPTION <name> <value>");

		if (argTokens[0]?.type !== "IDENTIFIER") throw new Error("Option name must be an identifier.");

		const optionName = argTokens[0].value.toLowerCase();
		const optionValue = this.assembler.expressionEvaluator.evaluate(argTokens.slice(1), context);

		switch (optionName) {
			case "local_label_char":
				if (typeof optionValue !== "string" || optionValue.length !== 1) throw new Error("Value for 'local_label_char' must be a single character string.");

				this.assembler.setOption("local_label_char", optionValue);
				break;
			default:
				this.assembler.warn(`Unknown option '${optionName}'.`);
		}
	}
}
