import type { EventEmitter } from "node:events";
import type { PushTokenStreamParams, StreamState } from "../assembler/polyasm.types";
import type { SymbolValue } from "../assembler/symbol.class";
import type { IDirective } from "../directives/directive.interface";
import { AssemblyLexer, type IdentifierToken, type LabelSyntax, type NumberToken, type StringToken, type Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { nestingDelta } from "../utils/token.utils";

/** Called right after a raw directive's name: returns the rest of the directive's tokens, raw text included. */
type GetRawBlock = (parser: Parser, directive: Token) => Token[];

/** The directives that end a branch of an `.if`: read by the `.if`, they aren't registered. */
const IF_BRANCHES = ["ELSEIF", "ELSE"];

/** An error at a token: its line and column are where it is reported. */
export class ParserError extends AsmError {
	public token: Token | null = null;
	public constructor(message: string, token?: Token | null) {
		super(message, token ? { line: token.line, column: token.column } : {});
		if (token !== undefined) this.token = token;
	}
}

export class Parser {
	public activeTokens: Token[] = [];
	public tokenStreamStack: StreamState[] = [];
	private streamIdCounter = 0;
	private tokenStreamCache: Map<string, StreamState> = new Map();
	public lexer: AssemblyLexer;
	/** Per parser: the assembler and the linker don't have the same directives. */
	private readonly directives: Set<string> = new Set();
	private readonly blockDirectives: Set<string> = new Set();
	private readonly rawDirectives: Map<string, GetRawBlock | undefined> = new Map();

	constructor(public emitter: EventEmitter) {
		this.lexer = new AssemblyLexer();
		emitter.on("option:local.prefix", (localPrefix: string) => this.setLabelSyntax({ ...this.lexer.labelSyntax, localPrefix }));
		emitter.on("option:anon.marker", (anonMarker: string) => this.setLabelSyntax({ ...this.lexer.labelSyntax, anonMarker }));
	}

	/** Inside a block, a block directive nests until its `.END`, and a raw directive reads its own tokens. */
	public registerDirective(name: string, directive: Pick<IDirective, "isBlockDirective" | "isRawDirective" | "getRawBlock">) {
		this.directives.add(name);
		if (directive.isBlockDirective) this.blockDirectives.add(name);
		if (directive.isRawDirective) this.rawDirectives.set(name, directive.getRawBlock);
	}

	public isKnownDirective(name: string): boolean {
		return this.directives.has(name);
	}

	/**
	 * Tokens not assembled (a branch not taken, what follows a `.exitmacro`) are still checked: a directive that starts
	 * one of their statements must exist, or a typo there would only show when they are assembled. A directive starts
	 * a statement at the start of a line, after a label or after a brace. `.elseif` and `.else` are read by their `.if`.
	 */
	public checkDirectives(tokens: Token[]) {
		for (let i = 0; i < tokens.length - 1; i++) {
			const dot = tokens[i] as Token;
			const name = tokens[i + 1] as Token;
			if (dot.type !== "DOT" || name.type !== "IDENTIFIER") continue;
			if (tokens[i + 2]?.type === "OPERATOR" && tokens[i + 2]?.value === "(") continue;

			const previous = tokens[i - 1];
			const startsStatement = !previous || previous.line !== dot.line || ["LBRACE", "RBRACE", "LABEL", "LOCAL_LABEL"].includes(previous.type);
			if (!startsStatement) continue;

			const directiveName = name.value as string;
			if (!this.isKnownDirective(directiveName) && !IF_BRANCHES.includes(directiveName))
				throw AsmError.at(`Syntax error - Unexpected directive '${directiveName}'`, name);
		}
	}

	/** Local and anonymous labels are lexed with `labelSyntax` from the statement being read on. */
	private setLabelSyntax(labelSyntax: LabelSyntax) {
		this.lexer.labelSyntax = labelSyntax;
		this.relexAhead();
	}

	/**
	 * Lexes again the tokens of the file being read lexed ahead with another label syntax (the start of the next
	 * line, to see where a statement ends). A file whose tokens were all read before, cached or in pass 2, keeps them.
	 */
	private relexAhead() {
		const fileStream = this.tokenStreamStack.findLast((stream) => stream.file !== undefined) ?? this.tokenStreamStack[0];
		if (fileStream?.tokens === this.lexer.getBufferedTokens()) this.lexer.relexFrom(fileStream.index);
	}

	/** A file's tokens depend on the label syntax: a file is cached for each one it's included with. */
	private fileCacheName(file: string) {
		const { localPrefix, anonMarker } = this.lexer.labelSyntax;
		return `${file}\0${localPrefix}${anonMarker}`;
	}

	public start(source: string): void {
		this.lexer.reset();
		// A new source: included files are read and tokenized again.
		this.tokenStreamCache.clear();

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

		let t: Token | null;
		if (this.activeTokens === lexerBuffer) t = this.lexer.ensureBuffered(index);
		// Otherwise we're operating on a pushed token stream (macro/block) that's an array.
		else t = this.activeTokens[index] ?? null;

		return t;
	}

	/** Get current stream position (internal index). */
	public getPosition(): number {
		if (this.tokenStreamStack.length === 0) return 0;
		return (this.tokenStreamStack[this.tokenStreamStack.length - 1] as StreamState).index;
	}

	/** Set current stream position (internal index). */
	public setPosition(pos: number): void {
		if (this.tokenStreamStack.length === 0) return;
		const stream = this.tokenStreamStack[this.tokenStreamStack.length - 1] as StreamState;
		// Moving past a token reads it: one the lexer couldn't make sense of is an error then, not when it was lexed ahead.
		for (let i = stream.index; i < pos; i++) {
			const token = stream.tokens[i];
			if (token?.type === "INVALID") throw new ParserError(token.value, token);
		}
		stream.index = pos;
	}

	/** Peek relative to the current token pointer (0 == current). */
	public peek(offset = 0): Token | null {
		return this.ensureToken(this.getPosition() + offset);
	}

	public advance(n = 1) {
		this.setPosition(this.getPosition() + n);
	}

	/** Read and consume the next token from the active stream. */
	public next(options?: { endMarker?: string; rawInline?: boolean; blockName?: string }): Token | null {
		const pos = this.getPosition();
		this.lexer.setRawMode(options);
		const t = this.ensureToken(pos);
		if (t) this.setPosition(pos + 1);
		return t;
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

	public consume(expectedType: Token["type"] | Token["type"][], expectedValue?: SymbolValue | SymbolValue[], _offset = 0) {
		const token = this.next();
		if (!token) return token;

		const isMatchingType = typeof expectedType === "string" ? token.type === expectedType : new Set(expectedType).has(token.type);
		const isMatchingValue =
			expectedValue === undefined ? true : Array.isArray(expectedValue) ? new Set(expectedValue).has(token.value) : token.value === expectedValue;

		if (isMatchingType && isMatchingValue) return token;

		throw new ParserError(`Syntax error - Expecting ${expectedType}${expectedValue ? ` with value ${expectedValue}` : ""}`, token);
	}

	public isIdentifier(expectedValue?: SymbolValue | SymbolValue[], offset = 0) {
		return this.is("IDENTIFIER", expectedValue, offset);
	}

	public identifier(expectedIdentifier?: string | string[]) {
		const token = this.consume("IDENTIFIER", expectedIdentifier);
		if (!token) throw new ParserError(`Syntax error - Expecting an identifer ${expectedIdentifier}`, token);
		return token as IdentifierToken;
	}

	public string(expectedString?: string) {
		const token = this.next();
		if (token?.type !== "STRING" || (expectedString && token.value !== expectedString))
			throw new ParserError(`Syntax error - Expecting a string ${expectedString}`, token);
		return token as StringToken;
	}

	public number(expectedNumber?: string) {
		const token = this.next();
		if (token?.type !== "NUMBER" || (expectedNumber && token.value !== expectedNumber))
			throw new ParserError(`Syntax error - Expecting a number ${expectedNumber}`, token);
		return token as NumberToken;
	}

	public isOperator(expectedValue?: SymbolValue | SymbolValue[], offset = 0) {
		return this.is("OPERATOR", expectedValue, offset);
	}

	public operator(expectedOperator?: string) {
		const token = this.next();
		if (token?.type !== "OPERATOR" || (expectedOperator && token.value !== expectedOperator))
			throw new ParserError(`Syntax error - Expecting an Operator ${expectedOperator}`, token);
		return token as IdentifierToken;
	}

	public isDirective(expectedValue?: SymbolValue | SymbolValue[], offset = 0) {
		return this.is("DOT", undefined, offset) && this.isIdentifier(expectedValue, offset + 1) && !this.opensCall(this.getPosition() + offset + 2);
	}

	/** True when the stream is past every token read so far: the next token would come from the lexer. */
	public isAtUnlexedSource(): boolean {
		const lexerBuffer = this.lexer.getBufferedTokens();
		return this.activeTokens === lexerBuffer && this.getPosition() >= lexerBuffer.length;
	}

	/**
	 * True when the token at `index` is '(' (a function call like `.hex(10)`, not a directive).
	 * A token not lexed yet is checked on the source instead, so a raw directive's data isn't lexed as tokens.
	 */
	private opensCall(index: number): boolean {
		const lexerBuffer = this.lexer.getBufferedTokens();
		if (this.activeTokens === lexerBuffer && index >= lexerBuffer.length) return this.lexer.nextCharOnLine() === "(";
		const token = this.ensureToken(index);
		return token?.type === "OPERATOR" && token.value === "(";
	}

	public directive(expectedValue?: SymbolValue | SymbolValue[]) {
		try {
			const token = this.next();
			if (token?.type !== "DOT") throw new ParserError("", token);
			return this.identifier(expectedValue as string);
		} catch (e) {
			if (e instanceof ParserError) {
				e.message = `Syntax error - Expecting a directive ${expectedValue}`;
				throw e;
			}
			throw new ParserError(`Syntax error - Expecting a directive ${expectedValue}`);
		}
	}

	public peekTokenUnbuffered(offset = 0): Token | null {
		const lexerPos = this.lexer.getPosition();
		const token = this.ensureToken(this.getPosition() + offset);
		this.lexer.rewind(offset + 1, lexerPos);
		return token;
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

	/** True when the tokens of the file `file`, read to its end with the current label syntax, are kept: pushing it reuses them. */
	public hasCachedFile(file: string): boolean {
		return this.tokenStreamCache.has(this.fileCacheName(file));
	}

	/** Returns the ID that will be used for the next stream. */
	public getNextStreamId(): number {
		return this.streamIdCounter + 1;
	}

	/** Pushes the current stream state and activates a new stream (macro/loop body). */
	public pushTokenStream({ newTokens, macroArgs, cacheName: name, file, macroName, macroCall, onEndOfStream }: PushTokenStreamParams): number {
		const cacheName = file === undefined ? name : this.fileCacheName(file);

		// Save current position and arguments
		if (this.tokenStreamStack.length > 0) (this.tokenStreamStack[this.tokenStreamStack.length - 1] as StreamState).index = this.getPosition();

		const newStreamId = ++this.streamIdCounter;

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

		if (onEndOfStream) this.emitter.once(`endOfStream:${newStreamId}`, onEndOfStream);

		// Push new context onto the stack
		this.tokenStreamStack.push({
			id: newStreamId,
			tokens: newTokens,
			index: 0,
			macroArgs,
			cacheName,
			file,
			macroName,
			macroCall,
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
			// The file left may have changed the label syntax: the file back to was lexed ahead with the previous one.
			if (poppedStream?.file !== undefined) this.relexAhead();
		}
		return poppedStream;
	}

	/**
	 * Ends the `count` streams on top, what they have left unread: their end is told they were exited, so a loop
	 * doesn't run its next iteration.
	 */
	public exitTokenStreams(count: number) {
		for (let i = 0; i < count; i++) {
			const poppedStream = this.popTokenStream(false);
			if (poppedStream) this.emitter.emit(`endOfStream:${poppedStream.id}`, true);
		}
	}

	public getInstructionTokens(instructionToken?: Token): Token[] {
		const tokens: Token[] = [];

		const startToken = this.peek();
		// A '{' opens the directive's block, a '}' closes the block the line is in: never part of the line, as below (`.macro m {`, `{ nop }`).
		if (startToken?.type === "EOF" || startToken?.type === "LBRACE" || startToken?.type === "RBRACE") return tokens;
		if (instructionToken && instructionToken.line !== startToken?.line) return tokens;

		this.advance(1);
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
		// Inside ( ) or [ ]: a comma there belongs to a function call or an array literal, not the directive.
		let depth = 0;

		const startToken = this.peek();
		if (!startToken || startToken.type === "EOF") return tokens;
		if (instructionToken && instructionToken.line !== startToken.line) return tokens;

		let lastToken = startToken;

		this.advance(1);
		tokens.push(startToken);

		depth += nestingDelta(startToken);

		const startLine = instructionToken ? instructionToken.line : startToken.line;

		const currentTokens = new Set(["IDENTIFIER", "NUMBER", "STRING", "LABEL", "LOCAL_LABEL", "ANONYMOUS_LABEL_REF", "ARRAY"]);
		const previousTokens = new Set(["OPERATOR", "COMMA", "DOT"]);
		while (true) {
			const token = this.peek();
			if (!token || token.line !== startLine || token.type === "LBRACE" || token.type === "RBRACE" || token.type === "EOF") break;

			if (token.type === "COMMA" && depth <= 0) break;
			depth += nestingDelta(token);

			if (currentTokens.has(token.type) && !previousTokens.has(lastToken.type)) break;

			lastToken = token;

			this.advance(1);
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

		this.advance(); // consume '{'

		let braceDepth = 1;

		loop: while (!this.isEOS() && braceDepth > 0) {
			const current = this.peek() as Token;

			switch (current.type) {
				case "LBRACE":
					braceDepth++;
					tokens.push(current);
					this.advance();
					break;

				case "RBRACE":
					braceDepth--;
					if (braceDepth === 0) {
						this.advance();
						break loop; // Found matching closing brace
					}
					tokens.push(current);
					this.advance();
					break;

				case "DOT": {
					tokens.push(current);
					this.advance();

					const directive = this.next() as Token;
					tokens.push(directive);

					const directiveName = directive.value as string;
					const getRawBlock = this.rawDirectives.get(directiveName);
					if (getRawBlock && !this.opensCall(this.getPosition())) tokens.push(...getRawBlock(this, directive));
					break;
				}

				default:
					tokens.push(current);
					this.advance();
					break;
			}
		}

		if (braceDepth !== 0) throw new Error("Unmatched braces in block");

		return tokens;
	}

	private getKeywordBlock(startDirective: string, terminators: string[]): Token[] {
		const tokens: Token[] = [];
		let nestingDepth = 0;
		let braceDepth = 0;
		let terminated = false;
		// The block starts after its directive's line: the previous token is on that line.
		const startLine = this.ensureToken(this.getPosition() - 1)?.line;

		if (!terminators.includes("END")) terminators.push("END");

		while (!this.isEOS()) {
			const current = this.peek() as Token;

			// Track braces - directives inside braces don't count
			if (current.type === "LBRACE") {
				braceDepth++;
				tokens.push(current);
				this.advance();
				continue;
			}

			if (current.type === "RBRACE") {
				braceDepth--;
				tokens.push(current);
				this.advance();
				continue;
			}

			// Only check directives when not inside braces
			if (braceDepth === 0 && this.isDirective()) {
				const directive = this.peek(1) as Token;
				const directiveName = directive.value as string;

				const getRawBlock = this.rawDirectives.get(directiveName);
				if (getRawBlock) {
					tokens.push(current, directive);
					this.advance(2);
					tokens.push(...getRawBlock(this, directive));
					continue;
				}

				// Entering a nested block
				if (this.blockDirectives.has(directiveName)) {
					nestingDepth++;

					tokens.push(current);
					tokens.push(directive);
					this.advance(2);

					continue;
				}

				// Only consider terminators at OUR level (depth 0)
				if (nestingDepth === 0 && terminators.includes(directiveName)) {
					this.advance(2);
					terminated = true;
					break;
				}

				// Exiting a nested block
				if (directiveName === "END") {
					this.advance(2);

					if (nestingDepth > 0) {
						nestingDepth--;
					} else {
						// This END belongs to us - we're done, but we consumed it
						terminated = true;
						break;
					}
					tokens.push(current);
					tokens.push(directive);
					continue;
				}
			}

			tokens.push(current);
			this.advance();
		}

		// Reaching the end of the source means the block's .END is missing: don't silently take the rest of the file.
		if (!terminated) throw new AsmError(`Missing .END for the .${startDirective} block.`, { line: startLine });

		return tokens;
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
