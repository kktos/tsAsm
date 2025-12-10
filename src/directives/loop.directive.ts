import type { IdentifierToken, ScalarToken, Token } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { SymbolValue } from "../symbol.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

interface LoopState {
	iterator?: IdentifierToken;
	itemIterator?: IdentifierToken; // For .FOR loops
	// items?: (string | number)[]; // For .FOR loops
	items?: SymbolValue[]; // For .FOR loops
	body: Token[];
	// For .REPEAT loops
	repeatCount?: number;
	repeatTotal?: number;
}

export class LoopDirective implements IDirective {
	public isBlockDirective = true;
	public isRawDirective = false;

	// A map to store the state of active loops between iterations. Key: A unique identifier for the loop.
	private loopStates: Map<string, LoopState> = new Map();

	public handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		// const argTokens = assembler.parser.getInstructionTokens();
		// assembler.parser.skipToDirectiveEnd(directive.value);
		// assembler.lister.directive(directive, argTokens);
		switch (directive.value) {
			case "FOR":
				this.handleForLoop(directive, assembler, context);
				return;
			case "REPEAT":
				this.handleRepeatLoop(directive, assembler, context);
				return;
			default:
				throw new Error(`Invalid directive ${directive.value} on line ${directive.line}.`);
		}
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		switch (directive.value) {
			case "FOR":
				this.handleForLoop(directive, assembler, context);
				return;
			case "REPEAT":
				this.handleRepeatLoop(directive, assembler, context);
				return;
			default:
				throw new Error(`Invalid directive ${directive.value} on line ${directive.line}.`);
		}
	}

	private handleForLoop(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		// Parse the .for <iterator> of <array> syntax using buffered access
		const itemIteratorToken = assembler.parser.identifier();
		const ofToken = assembler.parser.identifier("OF");

		if (!itemIteratorToken || !ofToken) throw new Error(`Invalid .FOR loop syntax on line ${directive.line}. Expected: .for <iterator> of <array>`);

		// Find expression tokens on the header line after 'OF', optionally followed by 'AS'
		const exprHeader = assembler.parser.getInstructionTokens();
		let asIndex = exprHeader.findIndex((t) => t.type === "IDENTIFIER" && t.value === "AS");
		if (asIndex === -1) asIndex = exprHeader.length;
		const expressionTokens = exprHeader.slice(0, asIndex);
		const indexIteratorToken = asIndex < exprHeader.length ? (exprHeader[asIndex + 1] as IdentifierToken) : undefined;

		// Resolve the array from the symbol table
		const evaluationContext = {
			pc: assembler.currentPC,
			macroArgs: assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1]?.macroArgs,
			assembler,
			currentGlobalLabel: assembler.lastGlobalLabel ?? undefined,
		};

		const arrayValue = assembler.expressionEvaluator.evaluate(expressionTokens, evaluationContext);
		if (!Array.isArray(arrayValue))
			throw `line ${directive.line} The expression in the .FOR loop did not evaluate to an array.\nvalue: ${typeof arrayValue}\n${arrayValue}\n`;

		assembler.lister.directive(directive, itemIteratorToken, ofToken, exprHeader);

		// Find the loop body
		const bodyTokens = assembler.parser.getDirectiveBlockTokens(directive.value);

		// nothing to loop for then leave
		if (arrayValue.length === 0) return;

		// Create a local scope for the entire loop's duration.
		assembler.symbolTable.pushScope(`@@for_${directive.line}_`);

		// Store the complete state for the loop.
		const loopId = `${directive.line}`; // Use line number as a unique ID for the loop.
		this.loopStates.set(loopId, {
			itemIterator: itemIteratorToken,
			iterator: indexIteratorToken, // The index iterator
			items: arrayValue as SymbolValue[],
			repeatCount: arrayValue.length,
			repeatTotal: arrayValue.length,
			body: bodyTokens,
		});

		// Kick off the first iteration.
		this.runNextLoopIteration(assembler, loopId, context);
	}

	private handleRepeatLoop(directive: ScalarToken, assembler: Assembler, context: DirectiveContext): void {
		const countExpressionTokens = assembler.parser.getInstructionTokens();

		// If there is an 'AS' clause, split it
		const asPos = countExpressionTokens.findIndex((t) => t.type === "IDENTIFIER" && t.value === "AS");
		let iteratorToken: IdentifierToken | undefined;
		const exprTokens = asPos === -1 ? countExpressionTokens : countExpressionTokens.slice(0, asPos);
		if (asPos !== -1) iteratorToken = countExpressionTokens[asPos + 1] as IdentifierToken;

		const evaluationContext = {
			pc: assembler.currentPC,
			macroArgs: assembler.parser.tokenStreamStack[assembler.parser.tokenStreamStack.length - 1]?.macroArgs,
			assembler,
			currentGlobalLabel: assembler.lastGlobalLabel ?? undefined,
		};

		const count = assembler.expressionEvaluator.evaluateAsNumber(exprTokens, evaluationContext);
		if (count <= 0) throw new Error("Repeat count must be a positive integer.");

		// Find loop body
		const bodyTokens = assembler.parser.getDirectiveBlockTokens(directive.value);

		// Setup scope and state
		assembler.symbolTable.pushScope();
		const loopId = `${directive.line}`;
		this.loopStates.set(loopId, {
			iterator: iteratorToken,
			repeatCount: count,
			repeatTotal: count,
			body: bodyTokens,
		});

		// kick off iteration
		this.runNextLoopIteration(assembler, loopId, context);
	}

	private runNextLoopIteration(assembler: Assembler, loopId: string, context: DirectiveContext): void {
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
				assembler.symbolTable.assignVariable(state.iterator.value, iteratorValue);
			}

			// Handle .FOR specific item value
			if (state.items && state.itemIterator) {
				const currentItem = state.items[currentIndex] as SymbolValue;
				assembler.symbolTable.assignVariable(state.itemIterator.value, currentItem);
			}

			assembler.parser.pushTokenStream({
				newTokens: state.body,
				macroArgs: context.macroArgs,
				onEndOfStream: () => this.runNextLoopIteration(assembler, loopId, context),
			});
		} else {
			// No iterations left, end the loop.
			this.endLoop(assembler, loopId);
		}
	}

	private endLoop(assembler: Assembler, loopId: string): void {
		assembler.symbolTable.popScope();
		this.loopStates.delete(loopId);
	}
}
