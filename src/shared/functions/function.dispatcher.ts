import type { PASymbolTable } from "../../assembler/symbol.class";
import type { Token } from "../lexer/lexer.class";
import { arrayFunction } from "./array.function";
import { defFunction, undefFunction } from "./def.function";
import { hexFunction } from "./hex.function";
import { hibyteFunction } from "./hibyte.function";
import { iifFunction } from "./iif.function";
import { joinFunction } from "./join.function";
import { jsonFunction } from "./json.function";
import { lenFunction } from "./len.function";
import { lobyteFunction } from "./lobyte.function";
import { popFunction } from "./pop.function";
import { pushFunction } from "./push.function";
import { splitFunction } from "./split.function";
import { strFunction } from "./str.function";
import { typeFunction } from "./type.function";
import type { EvaluationStack, IFunctionDef } from "./types";

const functions = new Map<string, IFunctionDef>();

// Register functions with their argument constraints
functions.set("LEN", { handler: lenFunction, minArgs: 1, maxArgs: 1 });

functions.set("DEF", { handler: defFunction, minArgs: 1, maxArgs: 1 });
functions.set("UNDEF", { handler: undefFunction, minArgs: 1, maxArgs: 1 });

functions.set("STR", { handler: strFunction, minArgs: 1, maxArgs: 2 });
functions.set("HEX", { handler: hexFunction, minArgs: 1, maxArgs: 2 });
functions.set("SPLIT", { handler: splitFunction, minArgs: 1, maxArgs: 2 });

functions.set("ARRAY", {
	handler: arrayFunction,
	minArgs: 0,
	maxArgs: Number.POSITIVE_INFINITY,
});
functions.set("PUSH", {
	handler: pushFunction,
	minArgs: 2,
	maxArgs: Number.POSITIVE_INFINITY,
});
functions.set("POP", { handler: popFunction, minArgs: 1, maxArgs: 1 });

functions.set("TYPE", { handler: typeFunction, minArgs: 1, maxArgs: 1 });
functions.set("JSON", { handler: jsonFunction, minArgs: 1, maxArgs: 1 });
functions.set("IIF", { handler: iifFunction, minArgs: 3, maxArgs: 3 });
functions.set("JOIN", { handler: joinFunction, minArgs: 2, maxArgs: 2 });

functions.set("LOBYTE", { handler: lobyteFunction, minArgs: 1, maxArgs: 1 });
functions.set("HIBYTE", { handler: hibyteFunction, minArgs: 1, maxArgs: 1 });

export function functionDispatcher(name: string, stack: EvaluationStack, token: Token, symbolTable: PASymbolTable, argCount = 0): void {
	const funcDef = functions.get(name.toUpperCase());
	if (!funcDef) throw new Error(`Unknown function '${name}' on line ${token.line}.`);

	// Centralized argument count validation
	if (argCount < funcDef.minArgs || argCount > funcDef.maxArgs)
		throw new Error(`Function '${name}' expects between ${funcDef.minArgs} and ${funcDef.maxArgs} arguments, but got ${argCount} on line ${token.line}.`);

	funcDef.handler(stack, token, symbolTable, argCount);
}
