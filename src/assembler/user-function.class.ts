import type { IdentifierToken, Token } from "../shared/lexer/lexer.class";
import type { DefinitionSite } from "../utils/error.utils";

/** A function `.function` defines, the value of its name: called as `name(…)` in an expression. */
export class UserFunction {
	constructor(
		/** As written, for messages. */
		public readonly name: string,
		public readonly parameters: readonly IdentifierToken[],
		/** The expression after `=`. */
		public readonly body: readonly Token[],
		/** The scopes where it's defined: its body reads their symbols, not the caller's. */
		public readonly scopes: readonly string[],
		/** Where it's defined, for the note of an error in its body. */
		public readonly site: DefinitionSite,
	) {}
}
