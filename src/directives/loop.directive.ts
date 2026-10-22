import type { SymbolValue } from "../assembler/symbol.class";
import type { IdentifierToken, ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

interface LoopState {
	iterator?: IdentifierToken;
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

		// Find expression tokens on the header line after 'OF', optionally followed by 'AS'
		const exprHeader = this.runtime.parser.getInstructionTokens();
		let asIndex = exprHeader.findIndex((t) => t.type === "IDENTIFIER" && t.value === "AS");
		if (asIndex === -1) asIndex = exprHeader.length;
		const expressionTokens = exprHeader.slice(0, asIndex);
		const indexIteratorToken = asIndex < exprHeader.length ? (exprHeader[asIndex + 1] as IdentifierToken) : undefined;

		// Resolve the array from the symbol table
		const arrayValue = this.runtime.evaluator.evaluate(expressionTokens, context) as SymbolValue[];
		// if (!Array.isArray(arrayValue))
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
			items: arrayValue as SymbolValue[],
			repeatCount: arrayValue.length,
			repeatTotal: arrayValue.length,
			body: bodyTokens,
			restoreSymbols: [],
		});

		// Define the index and item iterator variables
		if (indexIteratorToken) this.defineIterator(loopId, indexIteratorToken, directive, context);
		this.defineIterator(loopId, itemIteratorToken, directive, context);

		// Kick off the first iteration.
		this.runNextLoopIteration(loopId, context);
	}

	private handleRepeatLoop(directive: ScalarToken, context: DirectiveContext): void {
		const countExpressionTokens = this.runtime.parser.getInstructionTokens();

		// If there is an 'AS' clause, split it
		const asPos = countExpressionTokens.findIndex((t) => t.type === "IDENTIFIER" && t.value === "AS");
		let iteratorToken: IdentifierToken | undefined;
		const exprTokens = asPos === -1 ? countExpressionTokens : countExpressionTokens.slice(0, asPos);
		if (asPos !== -1) iteratorToken = countExpressionTokens[asPos + 1] as IdentifierToken;

		const count = this.runtime.evaluator.evaluateAsNumber(exprTokens, context);
		if (!Number.isInteger(count) || (count as number) < 0) throw new Error(`.REPEAT count: ${count} isn't a whole number (0 or more).`);

		// Find loop body
		const bodyTokens = this.runtime.parser.getDirectiveBlockTokens(directive.value);

		// nothing to repeat then leave, like an empty .FOR
		if (count === 0) return;

		// Setup state
		const loopId = `${directive.line}`;
		this.loopStates.set(loopId, {
			iterator: iteratorToken,
			repeatCount: count,
			repeatTotal: count,
			body: bodyTokens,
			restoreSymbols: [],
		});

		// Define the main iterator variable
		if (iteratorToken) this.defineIterator(loopId, iteratorToken, directive, context);

		// kick off iteration
		this.runNextLoopIteration(loopId, context);
	}

	private runNextLoopIteration(loopId: string, context: DirectiveContext): void {
		const state = this.loopStates.get(loopId);
		if (!state) return; // Should not happen

		// Unified loop handling for .FOR and .REPEAT
		if (state.repeatCount !== undefined && state.repeatCount > 0) {
			// Calculate an incrementing 0-based index for the current iteration
			const currentIndex = (state.repeatTotal ?? 0) - state.repeatCount;
			state.repeatCount--; // Decrement remaining count for the next call

			// Define the main iterator variable (0-based index for .FOR, 1-based for .REPEAT)
			if (state.iterator) {
				const iteratorValue = state.items ? currentIndex : currentIndex + 1;
				this.runtime.symbolTable.assignVariable(state.iterator.value, iteratorValue);
			}

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
	private defineIterator(loopId: string, iterator: IdentifierToken, directive: ScalarToken, context: DirectiveContext) {
		const state = this.loopStates.get(loopId) as LoopState;
		state.restoreSymbols.push(this.runtime.symbolTable.stashSymbol(iterator.value));
		this.runtime.symbolTable.defineVariable(iterator.value, 0, {
			filename: context.filename,
			line: directive.line,
			column: directive.column,
		});
	}
}
