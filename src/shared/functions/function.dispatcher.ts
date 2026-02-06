import type { PASymbolTable } from "../../assembler/symbol.class";
import type { Token } from "../lexer/lexer.class";
import { arrayFunction } from "./array.function";
import { ceilFunction } from "./ceil.function";
import { defFunction, undefFunction } from "./def.function";
import { floorFunction } from "./floor.function";
import { hexFunction } from "./hex.function";
import { hibyteFunction } from "./hibyte.function";
import { iifFunction } from "./iif.function";
import { joinFunction } from "./join.function";
import { jsonFunction } from "./json.function";
import { labelFunction } from "./label.function";
import { lenFunction } from "./len.function";
import { lobyteFunction } from "./lobyte.function";
import { popFunction } from "./pop.function";
import { pushFunction } from "./push.function";
import { roundFunction } from "./round.function";
import { splitFunction } from "./split.function";
import { strFunction } from "./str.function";
import { typeFunction } from "./type.function";
import type { EvaluationStack, IFunctionDef, SymbolResolver } from "./types";

export class FunctionDispatcher {
	private readonly functions = new Map<string, IFunctionDef>();

	constructor() {
		this.registerDefaultFunctions();
	}

	public register(name: string, definition: IFunctionDef): void {
		this.functions.set(name.toUpperCase(), definition);
	}

	private registerDefaultFunctions(): void {
		// Register functions with their argument constraints
		this.register("LEN", { handler: lenFunction, minArgs: 1, maxArgs: 1 });
		this.register("LABEL", { handler: labelFunction, minArgs: 1, maxArgs: 1 });
		this.register("DEF", { handler: defFunction, minArgs: 1, maxArgs: 1 });
		this.register("UNDEF", { handler: undefFunction, minArgs: 1, maxArgs: 1 });
		this.register("STR", { handler: strFunction, minArgs: 1, maxArgs: 2 });
		this.register("HEX", { handler: hexFunction, minArgs: 1, maxArgs: 2 });
		this.register("SPLIT", { handler: splitFunction, minArgs: 1, maxArgs: 2 });
		this.register("ARRAY", {
			handler: arrayFunction,
			minArgs: 0,
			maxArgs: Number.POSITIVE_INFINITY,
		});
		this.register("PUSH", {
			handler: pushFunction,
			minArgs: 2,
			maxArgs: Number.POSITIVE_INFINITY,
		});
		this.register("POP", { handler: popFunction, minArgs: 1, maxArgs: 1 });
		this.register("TYPE", { handler: typeFunction, minArgs: 1, maxArgs: 1 });
		this.register("JSON", { handler: jsonFunction, minArgs: 1, maxArgs: 1 });
		this.register("IIF", { handler: iifFunction, minArgs: 3, maxArgs: 3 });
		this.register("JOIN", { handler: joinFunction, minArgs: 2, maxArgs: 2 });
		this.register("LOBYTE", { handler: lobyteFunction, minArgs: 1, maxArgs: 1 });
		this.register("HIBYTE", { handler: hibyteFunction, minArgs: 1, maxArgs: 1 });

		this.register("CEIL", { handler: ceilFunction, minArgs: 1, maxArgs: 1 });
		this.register("FLOOR", { handler: floorFunction, minArgs: 1, maxArgs: 1 });
		this.register("ROUND", { handler: roundFunction, minArgs: 1, maxArgs: 1 });
	}

	public dispatch(name: string, stack: EvaluationStack, token: Token, symbolTable: PASymbolTable, argCount = 0, resolver?: SymbolResolver): void {
		const funcDef = this.functions.get(name.toUpperCase());
		if (!funcDef) throw new Error(`Unknown function '${name}' on line ${token.line}.`);

		// Centralized argument count validation
		if (argCount < funcDef.minArgs || argCount > funcDef.maxArgs)
			throw new Error(`Function '${name}' expects between ${funcDef.minArgs} and ${funcDef.maxArgs} arguments, but got ${argCount} on line ${token.line}.`);

		funcDef.handler(stack, token, symbolTable, argCount, resolver);
	}
}
