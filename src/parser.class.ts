import type { EventEmitter } from "node:events";
import { rawDirectives } from "./directives/handler";
import type { AssemblyLexer, IdentifierToken, ScalarToken, Token } from "./lexer/lexer.class";
import type { PushTokenStreamParams, StreamState } from "./polyasm.types";
import type { SymbolValue } from "./symbol.class";

export class Parser {
	static readonly EOF = "@@EOF";

	public activeTokens: Token[] = [];
	public tokenStreamStack: StreamState[] = [];
	private streamIdCounter = 0;
	private tokenStreamCache: Map<string, StreamState> = new Map();

	constructor(
		public lexer: AssemblyLexer,
		private emitter: EventEmitter,
	) {}

	public start(source: string): void {
		// Start streaming tokens instead of tokenizing the entire source.
		this.lexer.startStream(source);
		this.activeTokens = this.lexer.getBufferedTokens();

		// Initialize token stream stack so Pass 1 can use positional helpers.
		this.tokenStreamStack = [];
		this.streamIdCounter = 0;
		this.tokenStreamStack.push({
			id: this.streamIdCounter,
			tokens: this.activeTokens,
			index: 0,
		});
		this.activeTokens = (this.tokenStreamStack[this.tokenStreamStack.length - 1] as StreamState).tokens;
	}

	public restart(): void {
		this.tokenStreamStack = [];
		this.streamIdCounter = 0;
		this.tokenStreamStack.push({
			id: this.streamIdCounter,
			tokens: this.activeTokens,
			index: 0,
		});
		this.activeTokens = (this.tokenStreamStack[this.tokenStreamStack.length - 1] as StreamState).tokens;
	}

	/** Ensures a token at `index` is buffered and returns it. */
	public ensureToken(index: number): Token | null {
		// If the current activeTokens is the lexer's buffer, request buffering from lexer.
		const lexerBuffer = this.lexer.getBufferedTokens();
		if (this.activeTokens === lexerBuffer) {
			const t = this.lexer.ensureBuffered(index);
			// refresh reference in case lexer expanded the buffer
			// this.activeTokens = this.lexer.getBufferedTokens();
			return t;
		}
		// Otherwise we're operating on a pushed token stream (macro/block) that's an array.
		return this.activeTokens[index] ?? null;
	}

	/** Get current stream position (internal index). */
	public getPosition(): number {
		if (this.tokenStreamStack.length === 0) return 0;
		return (this.tokenStreamStack[this.tokenStreamStack.length - 1] as StreamState).index;
	}

	/** Set current stream position (internal index). */
	public setPosition(pos: number): void {
		if (this.tokenStreamStack.length === 0) return;
		(this.tokenStreamStack[this.tokenStreamStack.length - 1] as StreamState).index = pos;
	}

	/** Peek relative to the current token pointer (0 == current). */
	public peek(offset = 0): Token | null {
		return this.ensureToken(this.getPosition() + offset);
	}

	public isEOS(offset = 0) {
		const token = this.ensureToken(this.getPosition() + offset);
		return !token || token.type === "EOF";
	}

	public is(expectedType: Token["type"] | Token["type"][], expectedValue?: SymbolValue | SymbolValue[], offset = 0) {
		const token = this.ensureToken(this.getPosition() + offset);
		if (!token) return false;

		const isMatchingType = typeof expectedType === "string" ? token.type === expectedType : new Set(expectedType).has(token.type);
		const isMatchingValue =
			expectedValue === undefined ? true : Array.isArray(expectedValue) ? new Set(expectedValue).has(token.value) : token.value === expectedValue;

		return isMatchingType && isMatchingValue;
	}

	public isIdentifier(expectedValue?: SymbolValue | SymbolValue[], offset = 0) {
		return this.is("IDENTIFIER", expectedValue, offset);
	}

	public identifier(expectedIdentifier?: string) {
		const token = this.next();
		if (!token || token.type !== "IDENTIFIER" || (expectedIdentifier && token.value !== expectedIdentifier))
			throw `Syntax error - Expecting an identifer ${expectedIdentifier}`;
		return token as IdentifierToken;
	}

	public operator(expectedOperator?: string) {
		const token = this.next();
		if (!token || token.type !== "OPERATOR" || (expectedOperator && token.value !== expectedOperator))
			throw `Syntax error - Expecting an Operator ${expectedOperator}`;
		return token as IdentifierToken;
	}

	public isDirective(expectedValue?: SymbolValue | SymbolValue[], offset = 0) {
		return this.is("DOT", undefined, offset) && this.isIdentifier(expectedValue, offset + 1);
	}

	public directive(expectedValue?: SymbolValue | SymbolValue[]) {
		try {
			if (this.next()?.type !== "DOT") throw "";
			return this.identifier(expectedValue as string);
		} catch (_e) {
			throw `Syntax error - Expecting a directive ${expectedValue}`;
		}
	}

	public peekTokenUnbuffered(offset = 0): Token | null {
		const lexerPos = this.lexer.getPosition();
		const token = this.ensureToken(this.getPosition() + offset);
		this.lexer.rewind(offset + 1, lexerPos);
		return token;
	}

	/** Read and consume the next token from the active stream. */
	public next(options?: { endMarker?: string }): Token | null {
		const pos = this.getPosition();
		this.lexer.setEndMarker(options?.endMarker);
		const t = this.ensureToken(pos);
		if (t) this.setPosition(pos + 1);
		return t;
	}

	/** Advance the current token pointer by `n`. */
	public consume(n = 1): void {
		this.setPosition(this.getPosition() + n);
	}

	/** Slice tokens from start (inclusive) to end (exclusive) using buffered access. */
	public sliceTokens(start: number, end: number): Token[] {
		const out: Token[] = [];
		for (let i = start; i < end; i++) {
			const t = this.ensureToken(i);
			if (!t) break;
			out.push(t);
		}
		return out;
	}

	/** Returns all tokens on the current line starting at optional offset (relative). */
	public getLineTokens(offset = 0): Token[] {
		const out: Token[] = [];
		const base = this.getPosition() + offset;
		const start = this.ensureToken(base);
		if (!start) return out;
		const line = start.line;
		let i = base;
		while (true) {
			const t = this.ensureToken(i);
			if (!t) break;
			if (t.line !== line) break;
			out.push(t);
			i++;
		}
		return out;
	}

	/** Consumes tokens until the end of the current line (advances position to next line). */
	public consumeLine(): void {
		const startPos = this.getPosition();
		const startToken = this.ensureToken(startPos);
		if (!startToken) return;
		const line = startToken.line;
		let i = startPos;
		while (true) {
			const t = this.ensureToken(i);
			if (!t) break;
			i++;
			if (t.line !== line) break;
		}
		this.setPosition(i);
	}

	/** Returns the ID that will be used for the next stream. */
	public getNextStreamId(): number {
		return this.streamIdCounter + 1;
	}

	/** Pushes the current stream state and activates a new stream (macro/loop body). */
	public pushTokenStream({ newTokens, macroArgs, cacheName, onEndOfStream }: PushTokenStreamParams): number {
		// Save current position and arguments
		if (this.tokenStreamStack.length > 0) (this.tokenStreamStack[this.tokenStreamStack.length - 1] as StreamState).index = this.getPosition();

		if (cacheName) {
			const cachedStream = this.tokenStreamCache.get(cacheName);
			if (cachedStream) {
				this.tokenStreamStack.push(cachedStream);
				this.activeTokens = cachedStream.tokens;
				this.setPosition(0);
				if (onEndOfStream) this.emitter.once(`endOfStream:${cachedStream.id}`, onEndOfStream);
				return cachedStream.id;
			}
		}

		const newStreamId = ++this.streamIdCounter;

		if (onEndOfStream) this.emitter.once(`endOfStream:${newStreamId}`, onEndOfStream);

		// Push new context onto the stack
		this.tokenStreamStack.push({
			id: newStreamId,
			tokens: newTokens,
			index: 0,
			macroArgs,
			cacheName,
		});

		// Activate new stream
		this.activeTokens = newTokens;
		this.setPosition(0);
		return newStreamId;
	}

	/** Restores the previous stream state after a macro/loop finishes. */
	public popTokenStream(emitEvent = true): StreamState | undefined {
		const poppedStream = this.tokenStreamStack.pop();
		if (poppedStream && emitEvent) this.emitter.emit(`endOfStream:${poppedStream.id}`);

		if (poppedStream?.cacheName) this.tokenStreamCache.set(poppedStream.cacheName, poppedStream);

		if (this.tokenStreamStack.length > 0) {
			const previousState = this.tokenStreamStack[this.tokenStreamStack.length - 1] as StreamState;
			this.activeTokens = previousState.tokens;
			this.setPosition(previousState.index);
		}
		return poppedStream;
	}

	public getInstructionTokens(instructionToken?: Token): Token[] {
		const tokens: Token[] = [];

		const startToken = this.peek();
		if (startToken?.type === "EOF") return tokens;
		if (instructionToken && instructionToken.line !== startToken?.line) return tokens;

		this.consume(1);
		if (!startToken) return tokens;

		tokens.push(startToken);

		const startLine = instructionToken ? instructionToken.line : startToken.line;
		while (true) {
			let token = this.peek();
			if (!token) break;
			if (token.line !== startLine) break;
			if (token.type === "LBRACE" || token.type === "RBRACE" || token.type === "EOF") break;
			token = this.next();
			if (token) tokens.push(token);
		}
		return tokens;
	}

	public getExpressionTokens(instructionToken?: Token): Token[] {
		const tokens: Token[] = [];
		let parenDepth = 0;

		const startToken = this.peek();
		if (!startToken || startToken.type === "EOF") return tokens;
		if (instructionToken && instructionToken.line !== startToken.line) return tokens;

		this.consume(1);
		tokens.push(startToken);

		if (startToken.value === "(") parenDepth++;
		if (startToken.value === ")") parenDepth--;

		const startLine = instructionToken ? instructionToken.line : startToken.line;
		while (true) {
			const token = this.peek();
			if (!token || token.line !== startLine || token.type === "LBRACE" || token.type === "RBRACE" || token.type === "EOF") {
				break;
			}

			if (token.value === "(") {
				parenDepth++;
			} else if (token.value === ")") {
				parenDepth--;
			} else if (token.type === "COMMA" && parenDepth <= 0) {
				break;
			}

			this.consume(1);
			tokens.push(token);
		}
		return tokens;
	}

	public getDirectiveBlockTokens(startDirective: string, terminators: string[] = ["END"]): Token[] {
		if (this.is("LBRACE")) return this.getBracedBlock();
		return this.getKeywordBlock(startDirective, terminators);
	}

	private getBracedBlock(): Token[] {
		const tokens: Token[] = [];

		// Consume opening brace
		if (!this.is("LBRACE")) throw new Error("Expected '{' to start block");

		this.consume(); // consume '{'

		let braceDepth = 1;

		loop: while (!this.isEOS() && braceDepth > 0) {
			const current = this.peek() as Token;

			switch (current.type) {
				case "LBRACE":
					braceDepth++;
					tokens.push(current);
					this.consume();
					break;

				case "RBRACE":
					braceDepth--;
					if (braceDepth === 0) {
						this.consume();
						break loop; // Found matching closing brace
					}
					tokens.push(current);
					this.consume();
					break;

				case "DOT": {
					tokens.push(current);
					this.consume();

					const directive = this.next() as Token;
					tokens.push(directive);

					const directiveName = directive.value as string;
					if (rawDirectives.has(directiveName)) {
						const lineTokens = this.getInstructionTokens(directive);
						tokens.push(...lineTokens);
						const block = this.next({ endMarker: ".END" });
						if (block) tokens.push(block);
					}
					break;
				}

				default:
					tokens.push(current);
					this.consume();
					break;
			}

			// if (current.type === "LBRACE") {
			// 	braceDepth++;
			// 	tokens.push(current);
			// 	this.consume();
			// } else if (current.type === "RBRACE") {
			// 	braceDepth--;
			// 	if (braceDepth === 0) {
			// 		this.consume();
			// 		break; // Found matching closing brace
			// 	}
			// 	tokens.push(current);
			// 	this.consume();
			// } else {
			// 	tokens.push(current);
			// 	this.consume();
			// }
		}

		if (braceDepth !== 0) throw new Error("Unmatched braces in block");

		return tokens;
	}

	private getKeywordBlock(startDirective: string, terminators: string[]): Token[] {
		const tokens: Token[] = [];
		let nestingDepth = 0;
		let braceDepth = 0;

		if (!terminators.includes("END")) terminators.push("END");

		while (!this.isEOS()) {
			const current = this.peek() as Token;

			// Track braces - directives inside braces don't count
			if (current.type === "LBRACE") {
				braceDepth++;
				tokens.push(current);
				this.consume();
				continue;
			}

			if (current.type === "RBRACE") {
				braceDepth--;
				tokens.push(current);
				this.consume();
				continue;
			}

			// Only check directives when not inside braces
			if (braceDepth === 0 && this.isDirective()) {
				const directive = this.peek(1) as Token;
				const directiveName = directive.value as string;

				if (rawDirectives.has(directiveName)) {
					const lineTokens = this.getInstructionTokens(directive);
					tokens.push(...lineTokens);
					const block = this.next({ endMarker: ".END" });
					if (block) tokens.push(block);
					continue;
				}

				// Entering a nested block of same type
				if (directiveName === startDirective) {
					nestingDepth++;

					// tokens.push(this.advance());
					tokens.push(current);
					tokens.push(directive);
					this.consume(2);

					continue;
				}

				// Only consider terminators at OUR level (depth 0)
				if (nestingDepth === 0 && terminators.includes(directiveName)) {
					this.consume(2);
					break;
				}

				// Exiting a nested block
				if (directiveName === "END") {
					// tokens.push(this.advance());
					this.consume(2);

					if (nestingDepth > 0) {
						nestingDepth--;
					} else {
						// This END belongs to us - we're done, but we consumed it
						break;
					}
					tokens.push(current);
					tokens.push(directive);
					continue;
				}
			}

			// tokens.push(this.advance());
			tokens.push(current);
			this.consume();
		}

		return tokens;
	}

	public _getDirectiveBlockTokens(startDirective: string, terminators: string[] = ["END"]) {
		const terminatorsSet = new Set(terminators);
		// const isEOFallowed = terminatorsSet.has(Parser.EOF);
		const tokens: Token[] = [];
		// const depth = this.is("LBRACE") ? 0 : 1;
		let braceDepth = 0;
		let nestingDepth = 0;

		while (!this.isEOS()) {
			const isDirective = this.isDirective();

			let token = this.next() as Token;
			tokens.push(token);

			// Track braces
			if (token.type === "LBRACE") braceDepth++;
			if (token.type === "RBRACE") braceDepth--;

			// Only check directives when not inside braces
			if (braceDepth === 0 && isDirective) {
				token = this.next() as ScalarToken;
				tokens.push(token);

				const directiveName = token.value;

				if (directiveName === startDirective) {
					nestingDepth++;
				} else if (nestingDepth === 0 && terminatorsSet.has(directiveName)) {
					// break;
					return tokens.slice(0, -2);
				} else if (directiveName === "END" && nestingDepth > 0) {
					nestingDepth--;
				}
			}

			// this.consume();
			// tokens.push(token);

			// case "LBRACE":
			// 	if (depth === 0) tokens.pop();
			// 	depth++;
			// 	break;
			// case "RBRACE":
			// 	depth--;
			// 	if (depth === 0) return tokens.slice(0, -1);
			// 	break;

			// switch (token.type) {
			// 	case "DOT": {
			// 		const nextToken = this.peek();
			// 		if (nextToken?.type === "IDENTIFIER") {
			// 			tokens.push(nextToken);
			// 			this.consume(1);
			// 			const directiveName = nextToken.value;

			// 			if (blockDirectives.has(directiveName)) {
			// 				const lineTokens = this.getInstructionTokens(nextToken);
			// 				if (!this.is("LBRACE")) depth++;
			// 				tokens.push(...lineTokens);
			// 				continue;
			// 			}

			// 			if (rawDirectives.has(directiveName)) {
			// 				const lineTokens = this.getInstructionTokens(nextToken);
			// 				tokens.push(...lineTokens);
			// 				const block = this.next({ endMarker: ".END" });
			// 				if (block) tokens.push(block);
			// 				continue;
			// 			}

			// 			if (terminatorsSet.has(directiveName)) {
			// 				depth--;
			// 				if (depth === 0) return tokens.slice(0, -2);
			// 			}
			// 			continue;
			// 		}
			// 		break;
			// 	}
			// }
		}

		return tokens;

		// if (isEOFallowed) return tokens;
		// throw new Error(`line ${token?.line} : Unterminated '${startDirective}' block.`);
	}

	public skipToEndOfLine(startIndex?: number): number {
		const start = startIndex ?? this.getPosition();
		const startToken = this.ensureToken(start);
		if (!startToken) return start;
		const startLine = startToken.line;
		let i = start + 1;
		while (true) {
			const t = this.ensureToken(i);
			if (!t) break;
			if (t.line !== startLine) break;
			if (t.type === "LBRACE" || t.type === "RBRACE") break;
			i++;
		}
		return i;
	}

	public skipToDirectiveEnd(startDirective: string): void {
		this.getDirectiveBlockTokens(startDirective);
	}
}
