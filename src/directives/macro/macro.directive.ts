import type { ScalarToken } from "../../lexer/lexer.class";
import type { Assembler } from "../../polyasm";
import type { DirectiveContext, IDirective } from "../directive.interface";

export class MacroDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		this.handleMacroDefinition(directive, assembler);
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		const nameToken = assembler.parser.nextIdentifier();
		if (!nameToken) throw `ERROR: Macro needs a name on line ${directive.line}.`;

		const definition = assembler.macroDefinitions.get(nameToken.value);
		if (!definition) throw `ERROR: Unable to find macro definition for '${nameToken.value}' on line ${directive.line}.`;

		assembler.parser.setPosition(definition.endPosition);
	}

	/** Pass 1: Parses and stores a macro definition. */
	private handleMacroDefinition(directive: ScalarToken, assembler: Assembler) {
		const nameToken = assembler.parser.nextIdentifier();
		if (!nameToken) throw `ERROR: Macro needs a name on line ${directive.line}.`;

		const macroName = nameToken.value;

		const { parameters, restParameter } = this.handleMacroParametersDefinition(directive, assembler);

		const bodyTokens = assembler.parser.getDirectiveBlockTokens(directive.value);
		if (!bodyTokens) throw `ERROR: Unterminated macro body for '${macroName}' on line ${directive.line}.`;

		const endPosition = assembler.parser.getPosition();

		assembler.macroDefinitions.set(macroName, {
			name: macroName,
			parameters,
			restParameter,
			body: bodyTokens,
			endPosition,
		});

		assembler.lister.directive(
			directive,
			`${nameToken.raw}(${parameters.join(", ")}${restParameter ? `${parameters.length ? ", " : ""}...${restParameter}` : ""})`,
		);
	}

	private handleMacroParametersDefinition(directive: ScalarToken, assembler: Assembler) {
		const parameters: string[] = [];
		let restParameter: string | undefined;

		const parameterTokens = assembler.parser.getInstructionTokens(directive);
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
					if (restToken?.type !== "IDENTIFIER") throw `ERROR: Expected identifier after '...' in macro definition on line ${directive.line}.`;

					restParameter = restToken.value;
					paramIndex++;

					// The rest parameter must be the last one. Check if we are at the end.
					const nextToken = parameterTokens[paramIndex];
					if (nextToken && ((hasParentheses && nextToken.value !== ")") || (!hasParentheses && nextToken.type === "COMMA")))
						throw `ERROR: The rest parameter must be the last parameter in a macro definition on line ${directive.line}.`;

					break; // End of parameters
				}

				if (token?.type === "IDENTIFIER") {
					parameters.push(token.value);
				} else if (token?.type !== "COMMA") {
					throw `SYNTAX ERROR: Unexpected token in macro parameter list on line ${directive.line}.`;
				}

				paramIndex++;
			}

			if (hasParentheses && parameterTokens[paramIndex]?.value === ")") paramIndex++;
			// Ensure no trailing tokens exist
			if (paramIndex < parameterTokens.length) throw `SYNTAX ERROR: Unexpected tokens at the end of macro parameter list on line ${directive.line}.`;
		}
		return { parameters, restParameter };
	}
}
