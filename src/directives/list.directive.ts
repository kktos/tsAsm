import type { Assembler } from "../assembler/polyasm";
import type { Logger } from "../helpers/logger.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class ListDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly assembler: Assembler,
		private readonly logger: Logger,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		this.setListing(directive, context);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		this.setListing(directive, context);
	}

	private setListing(directive: ScalarToken, context: DirectiveContext): void {
		const instruction = this.assembler.parser.identifier(["ON", "OFF", "FILE"]);

		const mode = instruction.value;
		switch (mode) {
			case "ON":
				this.logger.enabled = true;
				break;
			case "OFF":
				this.logger.enabled = false;
				break;
			case "FILE": {
				this.assembler.parser.operator("=");
				const expr = this.assembler.parser.getExpressionTokens(directive);
				const filename = this.assembler.expressionEvaluator.evaluate(expr, context);
				if (typeof filename !== "string") {
					this.assembler.warn(".LIST FILE requires a string argument.");
					break;
				}
				this.logger.pushConfig({ filename });
				break;
			}
			default:
				this.assembler.warn(`Invalid .LIST mode '${mode}': expected ON or OFF.`);
		}
	}
}
