import type { PASymbolTable } from "../../assembler/symbol.class";
import { AsmError } from "../../utils/error.utils";
import type { Token } from "../lexer/lexer.class";
import { arrayFunction } from "./array.function";
import { ceilFunction } from "./ceil.function";
import { defFunctions } from "./def.function";
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

	/** `.def()` / `.undef()`, which also see the macros `isMacroDefined` says are defined. */
	public registerDefFunctions(isMacroDefined?: (name: string) => boolean): void {
		for (const [name, definition] of Object.entries(defFunctions(isMacroDefined))) this.register(name, definition);
	}

	/** Whether the argument at `index` of the function, when a lone identifier, is the symbol's name: see `IFunctionDef.nameArgs`. */
	public isNameArgument(name: string, index: number): boolean {
		return index < (this.functions.get(name.toUpperCase())?.nameArgs ?? 0);
	}

	private registerDefaultFunctions(): void {
		// Register functions with their argument constraints
		this.register("LEN", { handler: lenFunction, minArgs: 1, maxArgs: 1 });
		this.register("LABEL", { handler: labelFunction, minArgs: 1, maxArgs: 1 });
		this.registerDefFunctions();
		this.register("STR", { handler: strFunction, minArgs: 1, maxArgs: 2 });
		this.register("HEX", { handler: hexFunction, minArgs: 1, maxArgs: 2 });
		this.register("SPLIT", { handler: splitFunction, minArgs: 1, maxArgs: 2 });
		this.register("ARRAY", {
			handler: arrayFunction,
			minArgs: 0,
			maxArgs: Number.POSITIVE_INFINITY,
			knownArgs: 0,
		});
		this.register("PUSH", {
			handler: pushFunction,
			minArgs: 2,
			maxArgs: Number.POSITIVE_INFINITY,
			knownArgs: 1,
		});
		this.register("POP", { handler: popFunction, minArgs: 1, maxArgs: 1 });
		this.register("TYPE", { handler: typeFunction, minArgs: 1, maxArgs: 1 });
		this.register("JSON", { handler: jsonFunction, minArgs: 1, maxArgs: 1 });
		this.register("IIF", { handler: iifFunction, minArgs: 3, maxArgs: 3, knownArgs: 1 });
		this.register("JOIN", { handler: joinFunction, minArgs: 2, maxArgs: 2 });
		this.register("LOBYTE", { handler: lobyteFunction, minArgs: 1, maxArgs: 1 });
		this.register("HIBYTE", { handler: hibyteFunction, minArgs: 1, maxArgs: 1 });

		this.register("CEIL", { handler: ceilFunction, minArgs: 1, maxArgs: 1 });
		this.register("FLOOR", { handler: floorFunction, minArgs: 1, maxArgs: 1 });
		this.register("ROUND", { handler: roundFunction, minArgs: 1, maxArgs: 1 });
	}

	public dispatch(
		name: string,
		stack: EvaluationStack,
		token: Token,
		symbolTable: PASymbolTable,
		argCount = 0,
		resolver?: SymbolResolver,
		allowForwardRef = false,
	): void {
		const funcDef = this.functions.get(name.toUpperCase());
		if (!funcDef) throw AsmError.at(`Unknown function '${name}'.`, token);

		// Centralized argument count validation
		if (argCount < funcDef.minArgs || argCount > funcDef.maxArgs)
			throw AsmError.at(`Function '${name}' expects between ${funcDef.minArgs} and ${funcDef.maxArgs} arguments, but got ${argCount}.`, token);

		// Pass 1: an argument not known yet makes the result not known yet.
		if (allowForwardRef) {
			const firstArg = stack.length - argCount;
			const knownArgs = stack.slice(firstArg, firstArg + (funcDef.knownArgs ?? argCount));
			if (knownArgs.includes(null)) {
				stack.length = firstArg;
				stack.push(null);
				return;
			}
		}

		funcDef.handler(stack, token, symbolTable, argCount, resolver, allowForwardRef);
	}
}
