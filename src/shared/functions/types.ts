import type { PASymbolTable, SymbolValue } from "../../assembler/symbol.class";
import type { Token } from "../lexer/lexer.class";

export type EvaluationStack = (SymbolValue | null)[];

export type SymbolResolver = (name: string) => SymbolValue | null | undefined;

/** A function given by its name to a function taking one, `f` in `.map(list, f)`: a user function, or a system one (`.lobyte`). */
export class FunctionRef {
	constructor(
		/** As written, without the dot of a system function. */
		public readonly name: string,
		public readonly isSystem: boolean,
		/** Where it's named: a call's errors are located there. */
		public readonly token: Token,
		/** How many arguments it takes, at least and at most. */
		public readonly arity: readonly [number, number],
	) {}

	public toString(): string {
		return this.isSystem ? `.${this.name}` : this.name;
	}
}

/** Calls `fn` with `args`: the evaluator's, which has the user functions and the context of the expression. */
export type FunctionCaller = (fn: FunctionRef, args: SymbolValue[]) => SymbolValue | null;

/** `allowForwardRef`: pass 1, where something defined later isn't known yet (`null`) rather than an error. */
export type FunctionHandler = (
	stack: EvaluationStack,
	token: Token,
	symbolTable: PASymbolTable,
	argCount?: number,
	resolver?: SymbolResolver,
	allowForwardRef?: boolean,
	call?: FunctionCaller,
) => void;

export interface IFunctionDef {
	handler: FunctionHandler;
	minArgs: number;
	maxArgs: number;
	/**
	 * How many leading arguments must be known for the result to be: in pass 1, if one isn't (a symbol defined later),
	 * the call gives null (not known yet) without running the handler, as the operators do. All of them by default.
	 */
	knownArgs?: number;
	/**
	 * How many leading arguments, when one is a lone identifier, are the symbol's name, not its value: `.def(X)` gets "X",
	 * known or not. A macro parameter stands for its argument. Any other expression is evaluated. None by default.
	 */
	nameArgs?: number;
	/**
	 * The index of the argument that is a function, written by its name: `f` or `.lobyte` in `.map(list, f)`, not called
	 * there. The handler gets it as a `FunctionRef`, and calls it with its `call`. None by default.
	 */
	functionArg?: number;
	/**
	 * Whether it takes relocatable values (`CODE+$0012`): a function that computes on its arguments can't, as their
	 * address is only known when the segment is loaded. Not by default.
	 */
	relocatable?: boolean;
}
