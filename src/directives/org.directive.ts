import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

/**
 * The PC set to a symbol defined after it (`.org later` / `later:`): pass 1 can't know where the code after it goes,
 * and a label there would be wherever the `.org` puts it. `how` is how the PC is set: `.org` or `* =`.
 */
export const forwardOrgError = (how: string) => new Error(`The ${how} address uses a symbol defined after it: define the symbol before the ${how}.`);

export class OrgDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly assembler: Assembler) {}

	public handlePassOne(_directive: ScalarToken, context: DirectiveContext) {
		this.assembler.linker.checkOrg();
		const orgExpressionTokens = this.assembler.parser.getInstructionTokens();

		let address: number | null;
		try {
			address = this.assembler.expressionEvaluator.evaluateAsNumber(orgExpressionTokens, context);
		} catch (e) {
			this.assembler.warn(`Could not evaluate the .ORG address, assuming $0000: ${e instanceof Error ? e.message : e}`);
			address = 0x0000;
		}
		// A symbol defined after the .org: unknown in pass 1, it's null.
		if (address === null) throw forwardOrgError(".org");
		this.assembler.checkAddress(address);
		context.PC.value = address;
	}

	public handlePassTwo(_directive: ScalarToken, context: DirectiveContext) {
		this.assembler.linker.checkOrg();
		const orgExpressionTokens = this.assembler.parser.getInstructionTokens();
		context.PC.value = this.assembler.expressionEvaluator.evaluateAsNumber(orgExpressionTokens, context);
		this.assembler.checkAddress(context.PC.value);
	}
}
