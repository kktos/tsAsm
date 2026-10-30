import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class OrgDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly assembler: Assembler) {}

	public handlePassOne(_directive: ScalarToken, context: DirectiveContext) {
		this.assembler.linker.checkOrg();
		const orgExpressionTokens = this.assembler.parser.getInstructionTokens();

		try {
			context.PC.value = this.assembler.expressionEvaluator.evaluateAsNumber(orgExpressionTokens, context);
		} catch (e) {
			this.assembler.warn(`Could not evaluate the .ORG address, assuming $0000: ${e instanceof Error ? e.message : e}`);
			context.PC.value = 0x0000;
		}
		this.assembler.checkAddress(context.PC.value);
	}

	public handlePassTwo(_directive: ScalarToken, context: DirectiveContext) {
		this.assembler.linker.checkOrg();
		const orgExpressionTokens = this.assembler.parser.getInstructionTokens();
		context.PC.value = this.assembler.expressionEvaluator.evaluateAsNumber(orgExpressionTokens, context);
		this.assembler.checkAddress(context.PC.value);
	}
}
