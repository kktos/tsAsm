import type { LocalOptions } from "../../assembler/options";
import type { Token } from "../../shared/lexer/lexer.class";
import type { IncludeStack } from "../../utils/error.utils";

/** Represents a defined Macro. */
export interface MacroDefinition {
	name: string;
	parameters: string[];
	restParameter?: string;
	body: Token[];
	endPosition: number;
	/** The file the macro is defined in: its body tokens' lines are lines of this file. */
	file: string;
	/** Where its .MACRO directive is. */
	line: number | string;
	column: number;
	/** The `.include` directives its file was reached through. */
	includeStack: IncludeStack;
	/** The local options where it's defined: its body runs with them. */
	options: LocalOptions;
}
