import type { Token } from "../../shared/lexer/lexer.class";

/** Represents a defined Macro. */
export interface MacroDefinition {
	name: string;
	parameters: string[];
	restParameter?: string;
	body: Token[];
	endPosition: number;
}
