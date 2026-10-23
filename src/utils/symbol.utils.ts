import type { PASymbolTable } from "../assembler/symbol.class";
import type { DirectiveContext } from "../directives/directive.interface";
import type { Token } from "../shared/lexer/lexer.class";

/** The first symbol of an expression that isn't defined (yet): through a macro parameter, the argument's. */
export function findUndefinedSymbol(tokens: Token[], context: DirectiveContext, symbolTable: PASymbolTable): string | undefined {
	for (const token of tokens) {
		if (token.type !== "IDENTIFIER") continue;
		for (const t of context.macroArgs?.get(token.value) ?? [token])
			if (t.type === "IDENTIFIER" && symbolTable.findSymbol(t.value) === undefined) return t.value;
	}
	return undefined;
}

/** `'NAME'` for the first undefined symbol of an expression, for messages: "… must be defined before it is used here". */
export function undefinedSymbolName(tokens: Token[], context: DirectiveContext, symbolTable: PASymbolTable): string {
	const name = findUndefinedSymbol(tokens, context, symbolTable);
	return name ? `'${name}'` : "Its symbol";
}
