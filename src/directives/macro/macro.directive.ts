import type { ScalarToken } from "../../shared/lexer/lexer.class";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "../directive.interface";

export class MacroDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, _context: DirectiveContext) {
		this.handleMacroDefinition(directive, _context);
	}

	public handlePassTwo(_directive: ScalarToken, _context: DirectiveContext) {
		const nameToken = this.runtime.parser.identifier();
		if (!nameToken) throw new Error("A macro needs a name.");

		const definition = this.runtime.macroHandler.macroDefinitions.get(nameToken.value);
		if (!definition) throw new Error(`Unable to find the definition of macro '${nameToken.value}'.`);

		this.runtime.parser.setPosition(definition.endPosition);
	}

	/** Pass 1: Parses and stores a macro definition. */
	public handleMacroDefinition(directive: ScalarToken, context: DirectiveContext) {
		const nameToken = this.runtime.parser.identifier();
		if (!nameToken) throw new Error("A macro needs a name.");

		const macroName = nameToken.value;

		// Pass 2 skips a definition by looking it up by name, so a name can only be defined once.
		if (this.runtime.macroHandler.macroDefinitions.has(macroName))
			throw new Error(`Macro '${nameToken.raw ?? macroName}' redefined: a macro can only be defined once.`);

		const { parameters, restParameter } = this.handleMacroParametersDefinition(directive);

		const bodyTokens = this.runtime.parser.getDirectiveBlockTokens(directive.value);
		if (!bodyTokens) throw new Error(`Unterminated macro body for '${macroName}'.`);

		const endPosition = this.runtime.parser.getPosition();

		this.runtime.macroHandler.macroDefinitions.set(macroName, {
			name: macroName,
			parameters,
			restParameter,
			body: bodyTokens,
			endPosition,
			file: context.filename,
		});

		this.runtime.lister.directive(
			directive,
			`${nameToken.raw}(${parameters.join(", ")}${restParameter ? `${parameters.length ? ", " : ""}...${restParameter}` : ""})`,
		);
	}

	private handleMacroParametersDefinition(directive: ScalarToken) {
		const parameters: string[] = [];
		let restParameter: string | undefined;

		const parameterTokens = this.runtime.parser.getInstructionTokens(directive);
		if (parameterTokens.length > 0) {
			let paramIndex = 0;
			const hasParentheses = parameterTokens[0]?.value === "(";
			if (hasParentheses) paramIndex++;

			while (paramIndex < parameterTokens.length) {
				const token = parameterTokens[paramIndex];
				if (hasParentheses && token?.value === ")") break;

				if (token?.type === "REST_OPERATOR") {
					paramIndex++;
					const restToken = parameterTokens[paramIndex];
					if (restToken?.type !== "IDENTIFIER") throw new Error("Expected an identifier after '...' in the macro definition.");

					restParameter = restToken.value;
					paramIndex++;

					// The rest parameter must be the last one. Check if we are at the end.
					const nextToken = parameterTokens[paramIndex];
					if (nextToken && ((hasParentheses && nextToken.value !== ")") || (!hasParentheses && nextToken.type === "COMMA")))
						throw new Error("The rest parameter must be the last parameter of a macro definition.");

					break; // End of parameters
				}

				if (token?.type === "IDENTIFIER") {
					parameters.push(token.value);
				} else if (token?.type !== "COMMA") {
					throw new Error("Unexpected token in the macro parameter list.");
				}

				paramIndex++;
			}

			if (hasParentheses && parameterTokens[paramIndex]?.value === ")") paramIndex++;
			// Ensure no trailing tokens exist
			if (paramIndex < parameterTokens.length) throw new Error("Unexpected tokens at the end of the macro parameter list.");
		}
		return { parameters, restParameter };
	}
}
