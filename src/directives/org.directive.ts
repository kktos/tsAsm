import type { Assembler } from "../assembler/polyasm";
import type { Logger } from "../helpers/logger.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class OrgDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly logger: Logger,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		const orgExpressionTokens = this.assembler.parser.getInstructionTokens();

		try {
			context.PC.value = this.assembler.expressionEvaluator.evaluateAsNumber(orgExpressionTokens, context);
		} catch (e) {
			this.logger.warn(`Warning on line ${directive.line}: Failed to evaluate .ORG expression. Assuming 0x0000. Error: ${e}`);
			context.PC.value = 0x0000;
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const orgExpressionTokens = this.assembler.parser.getInstructionTokens();
		try {
			context.PC.value = this.assembler.expressionEvaluator.evaluateAsNumber(orgExpressionTokens, context);
		} catch (e) {
			throw `line ${directive.line}: Failed to evaluate .ORG expression. ${e}`;
		}
	}
}
