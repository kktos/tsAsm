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

	private setListing(directive: ScalarToken, _context: DirectiveContext): void {
		const argsToken = this.assembler.parser.getInstructionTokens();

		if (argsToken.length !== 1) {
			this.logger.warn(`[LIST] Invalid .LIST syntax on line ${directive.line}. Expected ON or OFF.`);
			return;
		}

		const mode = argsToken[0]?.value;

		switch (mode) {
			case "ON":
				this.logger.enabled = true;
				break;
			case "OFF":
				this.logger.enabled = false;
				break;
			default:
				this.logger.warn(`[LIST] Invalid .LIST mode '${mode}' on line ${directive.line}. Expected ON or OFF.`);
		}
	}
}
