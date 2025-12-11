import type { Assembler } from "../assembler/polyasm";
import handlers from "../cpu";
import type { Lister } from "../helpers/lister.class";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class CpuDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly lister: Lister) {}

	private setCpu(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		const tokens = assembler.parser.getInstructionTokens();
		const cpuName = assembler.expressionEvaluator.evaluate(tokens, context);
		if (typeof cpuName !== "string") throw new Error(`ERROR on line ${directive.line}: ${directive.value} name must evaluate to a string.`);

		const upperCpuName = cpuName.toUpperCase();
		const handlerClass = handlers[upperCpuName];

		if (!handlerClass) throw new Error(`ERROR on line ${directive.line}: Unknown CPU name '${cpuName}'.`);
		if (assembler.getCPUHandler().cpuType !== upperCpuName) assembler.setCPUHandler(new handlerClass());

		this.lister.directive(directive, cpuName);
	}

	public handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		this.setCpu(directive, assembler, context);
	}
	public handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		this.setCpu(directive, assembler, context);
	}
}
