import { isOptionName, type OptionValue, optionValueError } from "../assembler/options";
import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class OptionDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly assembler: Assembler) {}

	public handlePassOne(_directive: ScalarToken, context: DirectiveContext) {
		this.setOption(context);
	}

	// Each pass starts with the default options and sets them again in the same order: see Assembler.resetOptions.
	public handlePassTwo(_directive: ScalarToken, context: DirectiveContext) {
		this.setOption(context);
	}

	private setOption(context: DirectiveContext): void {
		const argTokens = this.assembler.parser.getInstructionTokens();

		if (argTokens.length === 0) throw new Error("Invalid .OPTION syntax. Expected: .OPTION <name> <value>");
		if (argTokens[0]?.type !== "IDENTIFIER") throw new Error("Option name must be an identifier.");

		// A dotted name, like local.prefix
		let nameLength = 1;
		while (argTokens[nameLength]?.type === "DOT" && argTokens[nameLength + 1]?.type === "IDENTIFIER") nameLength += 2;
		const optionName = argTokens
			.slice(0, nameLength)
			.map((token) => token.value)
			.join("")
			.toLowerCase();

		if (argTokens.length === nameLength) throw new Error("Invalid .OPTION syntax. Expected: .OPTION <name> <value>");

		if (!isOptionName(optionName)) {
			if (this.assembler.pass === 1) this.assembler.warn(`Unknown option '${optionName}'.`);
			return;
		}

		const optionValue = this.assembler.expressionEvaluator.evaluate(argTokens.slice(nameLength), context);
		const error = optionValueError(optionName, optionValue);
		if (error) throw new Error(error);

		this.assembler.setOption(optionName, optionValue as OptionValue);
	}
}
