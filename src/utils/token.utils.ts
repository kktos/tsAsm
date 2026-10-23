import type { Token } from "../shared/lexer/lexer.class";

/** +1 for a `(` or `[` operator, -1 for a `)` or `]`, else 0: a comma only separates arguments outside them. A string `"("` isn't one. */
export function nestingDelta(token: Token): number {
	if (token.type !== "OPERATOR") return 0;
	if (token.value === "(" || token.value === "[") return 1;
	if (token.value === ")" || token.value === "]") return -1;
	return 0;
}

/** Index of the first comma outside `( )` and `[ ]`, or -1: `.min(1,2), [3,4][0]` splits at the second comma. */
export function findTopLevelComma(tokens: Token[]): number {
	let depth = 0;
	for (const [index, token] of tokens.entries()) {
		if (token.type === "COMMA" && depth <= 0) return index;
		depth += nestingDelta(token);
	}
	return -1;
}
