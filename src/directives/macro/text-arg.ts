import type { Token } from "../../shared/lexer/lexer.class";

/** The macro arguments written in `< >`: text, pasted as is. The others are values: expressions evaluated where they are used. */
const textArgs = new WeakSet<Token[]>();

export function markAsText(tokens: Token[]): Token[] {
	textArgs.add(tokens);
	return tokens;
}

export function isTextArg(tokens: Token[]): boolean {
	return textArgs.has(tokens);
}
