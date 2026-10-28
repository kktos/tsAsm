import type { IdentifierToken, Token } from "../shared/lexer/lexer.class";
import type { DefinitionSite } from "../utils/error.utils";
import type { LocalOptions } from "./options";

/** A function `.function` defines, the value of its name: called as `name(…)` in an expression. */
export class UserFunction {
	constructor(
		/** As written, for messages. */
		public readonly name: string,
		public readonly parameters: readonly IdentifierToken[],
		/** The expression after `=`, or the statements of a block, run up to a `.return`. */
		public readonly body: readonly Token[],
		public readonly isBlock: boolean,
		/** The scopes where it's defined: its body reads their symbols, not the caller's. */
		public readonly scopes: readonly string[],
		/** Where it's defined, for the note of an error in its body. */
		public readonly site: DefinitionSite,
		/** The local options where it's defined: a block runs with them, as a macro body does. */
		public readonly options: LocalOptions,
	) {}
}
