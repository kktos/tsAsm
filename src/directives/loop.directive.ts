import type { OptionName } from "../assembler/options";
import type { SymbolValue } from "../assembler/symbol.class";
import type { IdentifierToken, ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { undefinedSymbolName } from "../utils/symbol.utils";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

interface LoopState {
	iterator?: IdentifierToken;
	/** The iterator's first value */
	start: number;
	body: Token[];
	// For .FOR loops
	itemIterator?: IdentifierToken;
	items?: SymbolValue[];
	// For .REPEAT loops
	repeatCount?: number;
	repeatTotal?: number;
	// Puts back what the iterators replaced, at the loop's end
	restoreSymbols: (() => void)[];
}

export class LoopDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	// A map to store the state of active loops between iterations. Key: A unique identifier for the loop.
	private loopStates: Map<string, LoopState> = new Map();

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		switch (directive.value) {
			case "FOR":
				this.handleForLoop(directive, context);
				return;
			case "REPEAT":
				this.handleRepeatLoop(directive, context);
				return;
			default:
				throw new Error(`Invalid directive ${directive.value}.`);
		}
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		switch (directive.value) {
			case "FOR":
				this.handleForLoop(directive, context);
				return;
			case "REPEAT":
				this.handleRepeatLoop(directive, context);
				return;
			default:
				throw new Error(`Invalid directive ${directive.value}.`);
		}
	}

	private handleForLoop(directive: ScalarToken, context: DirectiveContext): void {
		// Parse the .for <iterator> of <array> syntax using buffered access
		const itemIteratorToken = this.runtime.parser.identifier();
		const ofToken = this.runtime.parser.identifier("OF");

		if (!itemIteratorToken || !ofToken) throw new Error("Invalid .FOR loop syntax. Expected: .for <iterator> of <array>");

		// The array expression, then AS <index> FROM <start>, both optional
		const exprHeader = this.runtime.parser.getInstructionTokens();
		const { valueTokens: expressionTokens, iterator: indexIteratorToken, start } = this.parseIterator(".FOR", "index", exprHeader, "for.start", context);

		// Resolve the array from the symbol table
		const arrayValue = this.runtime.evaluator.evaluate(expressionTokens, context) as SymbolValue[];
		// A symbol defined later is unknown in pass 1, where the number of iterations is needed to place what follows.
		if (arrayValue === null)
			throw new Error(
				`.FOR: ${undefinedSymbolName(expressionTokens, context, this.runtime.symbolTable)} must be defined before it is used here (the array is needed to place what follows).`,
			);
		if (typeof arrayValue !== "object" || typeof arrayValue[Symbol.iterator] !== "function")
			throw new Error(
				`The .FOR expression must give an array, not ${typeof arrayValue === "string" ? "a string" : `${typeof arrayValue} ${String(arrayValue)}`}.`,
			);

		this.runtime.lister.directive(directive, itemIteratorToken, ofToken, exprHeader);

		// Find the loop body
		const bodyTokens = this.runtime.parser.getDirectiveBlockTokens(directive.value);

		// nothing to loop for then leave
		if (arrayValue.length === 0) return;

		// Store the complete state for the loop.
		const loopId = `${directive.line}`; // Use line number as a unique ID for the loop.
		this.loopStates.set(loopId, {
			itemIterator: itemIteratorToken,
			iterator: indexIteratorToken, // The index iterator
			start,
			items: arrayValue as SymbolValue[],
			repeatCount: arrayValue.length,
			repeatTotal: arrayValue.length,
			body: bodyTokens,
			restoreSymbols: [],
		});

		// Define the index and item iterator variables
		if (indexIteratorToken) this.defineIterator(loopId, indexIteratorToken, context);
		this.defineIterator(loopId, itemIteratorToken, context);

		// Kick off the first iteration.
		this.runNextLoopIteration(loopId, context);
	}

	private handleRepeatLoop(directive: ScalarToken, context: DirectiveContext): void {
		// The count, then AS <iterator> FROM <start>, both optional
		const {
			valueTokens: exprTokens,
			iterator: iteratorToken,
			start,
		} = this.parseIterator(".REPEAT", "iterator", this.runtime.parser.getInstructionTokens(), "repeat.start", context);

		const count = this.runtime.evaluator.evaluateAsNumber(exprTokens, context);
		if (count === null)
			throw new Error(
				`.REPEAT: ${undefinedSymbolName(exprTokens, context, this.runtime.symbolTable)} must be defined before it is used here (the count is needed to place what follows).`,
			);
		if (!Number.isInteger(count) || (count as number) < 0) throw new Error(`.REPEAT count: ${count} isn't a whole number (0 or more).`);

		// Find loop body
		const bodyTokens = this.runtime.parser.getDirectiveBlockTokens(directive.value);

		// nothing to repeat then leave, like an empty .FOR
		if (count === 0) return;

		// Setup state
		const loopId = `${directive.line}`;
		this.loopStates.set(loopId, {
			iterator: iteratorToken,
			start,
			repeatCount: count,
			repeatTotal: count,
			body: bodyTokens,
			restoreSymbols: [],
		});

		// Define the main iterator variable
		if (iteratorToken) this.defineIterator(loopId, iteratorToken, context);

		// kick off iteration
		this.runNextLoopIteration(loopId, context);
	}

	/**
	 * Splits a loop's header into its value (the count, the array) and its `AS <iterator> FROM <start>` end, both parts
	 * optional and nothing after them. The iterator starts at FROM's value, else at the option's.
	 */
	private parseIterator(
		directiveName: string,
		role: string,
		tokens: Token[],
		startOption: OptionName,
		context: DirectiveContext,
	): { valueTokens: Token[]; iterator?: IdentifierToken; start: number } {
		const isKeyword = (token: Token | undefined, keyword: string) => token?.type === "IDENTIFIER" && token.value === keyword;
		const optionStart = this.runtime.option(startOption) as number;

		const asPos = tokens.findIndex((token) => isKeyword(token, "AS"));
		if (asPos === -1) {
			const fromToken = tokens.find((token) => isKeyword(token, "FROM"));
			if (fromToken) throw AsmError.at(`${directiveName}: FROM needs an ${role}: AS <${role}> FROM <start>.`, fromToken);
			return { valueTokens: tokens, start: optionStart };
		}

		const valueTokens = tokens.slice(0, asPos);
		const iteratorToken = tokens[asPos + 1];
		if (iteratorToken?.type !== "IDENTIFIER")
			throw AsmError.at(`${directiveName}: AS must be followed by the ${role}'s name.`, iteratorToken ?? (tokens[asPos] as Token));
		const iterator = iteratorToken as IdentifierToken;

		const fromToken = tokens[asPos + 2];
		if (!fromToken) return { valueTokens, iterator, start: optionStart };
		if (!isKeyword(fromToken, "FROM"))
			throw AsmError.at(
				`${directiveName}: unexpected '${fromToken.raw ?? fromToken.value}' after the ${role}: only FROM <start> can follow it.`,
				fromToken,
			);

		const startTokens = tokens.slice(asPos + 3);
		if (startTokens.length === 0) throw AsmError.at(`${directiveName}: FROM must be followed by the ${role}'s first value.`, fromToken);
		const start = this.runtime.evaluator.evaluateAsNumber(startTokens, context);
		if (start === null)
			throw new Error(
				`${directiveName}: ${undefinedSymbolName(startTokens, context, this.runtime.symbolTable)} must be defined before it is used here (the ${role}'s first value is needed in pass 1).`,
			);
		if (!Number.isInteger(start)) throw new Error(`${directiveName} FROM: ${start} isn't a whole number.`);

		return { valueTokens, iterator, start };
	}

	private runNextLoopIteration(loopId: string, context: DirectiveContext): void {
		const state = this.loopStates.get(loopId);
		if (!state) return; // Should not happen

		// Unified loop handling for .FOR and .REPEAT
		if (state.repeatCount !== undefined && state.repeatCount > 0) {
			// Calculate an incrementing 0-based index for the current iteration
			const currentIndex = (state.repeatTotal ?? 0) - state.repeatCount;
			state.repeatCount--; // Decrement remaining count for the next call

			// The main iterator: .FOR's index or .REPEAT's iterator
			if (state.iterator) this.runtime.symbolTable.assignVariable(state.iterator.value, state.start + currentIndex);

			// Handle .FOR specific item value
			if (state.items && state.itemIterator) {
				const currentItem = state.items[currentIndex] as SymbolValue;
				this.runtime.symbolTable.assignVariable(state.itemIterator.value, currentItem);
			}

			this.runtime.parser.pushTokenStream({
				newTokens: state.body,
				macroArgs: context.macroArgs,
				onEndOfStream: () => this.runNextLoopIteration(loopId, context),
			});
		} else {
			// No iterations left, end the loop.
			this.endLoop(loopId);
		}
	}

	private endLoop(loopId: string): void {
		const state = this.loopStates.get(loopId);
		for (const restore of state?.restoreSymbols.reverse() ?? []) restore();
		this.loopStates.delete(loopId);
	}

	/**
	 * A loop only generates lines, like a preprocessor: it has no scope, and what its body defines stays where the
	 * loop is. Only its iterators are local, like macro parameters: defined in the current scope for the loop (over
	 * any symbol of the same name), then the scope is put back as it was.
	 */
	private defineIterator(loopId: string, iterator: IdentifierToken, context: DirectiveContext) {
		const state = this.loopStates.get(loopId) as LoopState;
		state.restoreSymbols.push(this.runtime.symbolTable.stashSymbol(iterator.value));
		this.runtime.symbolTable.defineVariable(iterator.value, 0, {
			filename: context.filename,
			line: iterator.line,
			column: iterator.column,
		});
	}
}
