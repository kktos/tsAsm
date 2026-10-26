import type { SymbolValue } from "../../assembler/symbol.class";
import { AsmError } from "../../utils/error.utils";

export type TokenType =
	// Structural
	| "IDENTIFIER" // labels, symbols, instructions
	| "LABEL" // identifier followed by ':'
	| "LOCAL_LABEL" // :loop
	| "ANONYMOUS_LABEL_DEF" // :
	| "FUNCTION"
	| "SYSVAR"
	| "SYMBOL_NAME" // a symbol's name, not its value: `X` in `.def(X)`
	| "ANONYMOUS_LABEL_REF" // :- or :+ or :-- or :+3

	// Literals
	| "NUMBER" // $1234, %1010, 42, -50
	| "STRING"
	| "RAW_TEXT"
	| "ARRAY"
	| "OPERATOR"
	| "PROPERTY_ACCESS"
	| "REST_OPERATOR"

	// Punctuation
	| "DOT"
	| "COMMA"

	// Block
	| "LBRACE"
	| "RBRACE"

	// Special
	| "INVALID" // a char the lexer doesn't know: an error once the parser reads it, not when it's lexed ahead
	| "EOF";

type BaseToken = {
	line: number | string;
	column: number;
	raw?: string;
	argCount?: number;
};

export type StringValueToken<T extends TokenType> = BaseToken & {
	type: T;
	value: string;
};

export type OperatorToken = StringValueToken<"OPERATOR">;
export type FunctionToken = StringValueToken<"FUNCTION">;
export type NumberToken = StringValueToken<"NUMBER">;
export type StringToken = StringValueToken<"STRING">;
export type OperatorStackToken = OperatorToken | FunctionToken | NumberToken | IdentifierToken;
export type IdentifierToken = StringValueToken<"IDENTIFIER">;
export type PropAccessToken = StringValueToken<"PROPERTY_ACCESS">;

export type ScalarToken = StringValueToken<Exclude<TokenType, "ARRAY">>;

export type ArrayValueToken = BaseToken & {
	type: "ARRAY";
	value: SymbolValue[];
};

export type Token = ScalarToken | ArrayValueToken;

/** The chars starting local labels (`:loop`) and anonymous labels (`:`, `:-`, `:+2`): the `local.prefix` and `anon.marker` options. */
export type LabelSyntax = { localPrefix: string; anonMarker: string };

/** Where a token was lexed from, and with which label syntax: to lex it again with another one. */
type TokenStart = { pos: number; line: number; column: number; labelSyntax: LabelSyntax };

type Stream = {
	source: string;
	pos: number;
	line: number;
	column: number;
	length: number;
	tokenBuffer: Token[];
	/** The start of each token of `tokenBuffer`. */
	tokenStarts: TokenStart[];
};
export class AssemblyLexer {
	private endMarker: string | undefined;
	private rawInline = false;
	private rawBlockName: string | undefined;
	/** Set by the parser, which knows how far tokens were lexed ahead: see `relexFrom`. */
	public labelSyntax: LabelSyntax = { localPrefix: ":", anonMarker: ":" };

	private streamStack: Stream[] = [];
	private currentStream: Stream;

	public commentChar = ";";

	constructor() {
		this.currentStream = this.newStream("");
	}

	private newStream(source: string): Stream {
		return { source, pos: 0, line: 1, column: 1, length: source.length, tokenBuffer: [], tokenStarts: [] };
	}

	/** Tokenizes a whole source on its own stream: the stream being lexed, if any, is left as it was. */
	public tokenize(source: string): Token[] {
		const previousStream = this.currentStream;
		this.startStream(source);

		try {
			while (this.currentStream.pos < this.currentStream.length) {
				const start = this.tokenStart();
				const token = this.nextToken();
				if (!token) continue; // skip null tokens (e.g., newlines)

				if (token.type === "INVALID") throw AsmError.at(token.value, token);
				this.bufferToken(token, start);
				if (token.type === "EOF") break;
			}

			return this.currentStream.tokenBuffer.slice();
		} finally {
			this.streamStack.pop();
			this.currentStream = previousStream;
		}
	}

	public reset() {
		this.streamStack = [];
		this.currentStream = this.newStream("");
	}

	/** Initializes the lexer for incremental/token-stream consumption. */
	public startStream(source: string) {
		this.currentStream = this.newStream(source);
		// A byte order mark is an encoding marker, not source: skip it at the start of a source only.
		if (source.startsWith("﻿")) this.currentStream.pos = 1;
		this.streamStack.push(this.currentStream);
	}

	/**
	 * Makes the next token raw text: the lines up to `endMarker` (see scanRawTextBlock), or with `rawInline`
	 * the rest of the line or a '{ ... }' block (see scanRawInline). `blockName` names the directive in errors.
	 */
	public setRawMode({ endMarker, rawInline = false, blockName }: { endMarker?: string; rawInline?: boolean; blockName?: string } = {}): void {
		this.endMarker = endMarker;
		this.rawInline = rawInline;
		this.rawBlockName = blockName;
	}

	private rawBlockLabel() {
		return this.rawBlockName ? `the .${this.rawBlockName} block` : "the block";
	}

	/** The next character on the current line, after spaces: "" at the end of the line or of the source. Never lexes. */
	public nextCharOnLine(): string {
		const ch = this.currentStream.source[this.skipSpacesFrom(this.currentStream.pos)] ?? "";
		return ch === "\n" ? "" : ch;
	}

	/** True when only spaces or a comment are left on the current line. Never lexes. */
	public isRestOfLineBlank(): boolean {
		const pos = this.skipSpacesFrom(this.currentStream.pos);
		return this.nextCharOnLine() === "" || this.isCommentStart(pos);
	}

	private skipSpacesFrom(start: number): number {
		const source = this.currentStream.source;
		let pos = start;
		while (source[pos] === " " || source[pos] === "\t" || source[pos] === "\r") pos++;
		return pos;
	}

	private isCommentStart(pos: number): boolean {
		const source = this.currentStream.source;
		return source[pos] === this.commentChar || (source[pos] === "/" && (source[pos + 1] === "/" || source[pos + 1] === "*"));
	}

	/**
	 * Ensures the internal buffer contains a token at `index`. Returns the token
	 * if available, otherwise `null` (end of input).
	 */
	public ensureBuffered(index: number): Token | null {
		// Generate tokens until we have the requested index or reach EOF
		while (this.currentStream.tokenBuffer.length <= index) {
			// If we've already consumed the whole source, stop
			if (this.currentStream.pos >= this.currentStream.length) {
				// If EOF not yet buffered, push it
				if (this.currentStream.tokenBuffer.length === 0 || this.currentStream.tokenBuffer[this.currentStream.tokenBuffer.length - 1]?.type !== "EOF") {
					const eof = this.makeToken("EOF", "", this.currentStream.line, this.currentStream.column);
					this.bufferToken(eof, this.tokenStart());
				}
				break;
			}

			const start = this.tokenStart();
			const t = this.nextToken();
			if (!t) continue; // skip null tokens (e.g., newlines)
			this.bufferToken(t, start);
			if (t.type === "EOF") break;
		}

		if (this.endMarker)
			return this.scanRawTextBlock({
				line: this.currentStream.line,
				column: this.currentStream.column,
				hasToGoNextline: false,
			});

		const token = this.currentStream.tokenBuffer[index];
		if (!token) return null;

		if (token.type === "EOF" && this.streamStack.length > 1) {
			this.streamStack.pop();
			this.currentStream = this.streamStack[this.streamStack.length - 1] as Stream;
		}
		return token;
	}

	/** Returns the buffered tokens (may grow as ensureBuffered is called). */
	public getBufferedTokens(): Token[] {
		return this.currentStream.tokenBuffer;
	}

	public rewind(offset: number, pos: { line: number; column: number; pos: number }) {
		const stream = this.currentStream;
		const isAlreadyOn = pos.line === stream.line && pos.column === stream.column && pos.pos === stream.pos;
		if (isAlreadyOn) return;
		stream.tokenBuffer.length -= offset;
		stream.tokenStarts.length = stream.tokenBuffer.length;
		stream.line = pos.line;
		stream.column = pos.column;
		stream.pos = pos.pos;
	}

	/**
	 * The tokens of the current stream buffered from `index` on were lexed ahead: if it was with another label
	 * syntax than the current one, they are dropped, to be lexed again from where they started.
	 */
	public relexFrom(index: number) {
		const stream = this.currentStream;
		const start = stream.tokenStarts[index];
		if (!start) return;
		const { localPrefix, anonMarker } = start.labelSyntax;
		if (localPrefix === this.labelSyntax.localPrefix && anonMarker === this.labelSyntax.anonMarker) return;

		stream.tokenBuffer.length = index;
		stream.tokenStarts.length = index;
		stream.pos = start.pos;
		stream.line = start.line;
		stream.column = start.column;
	}

	private tokenStart(): TokenStart {
		const { pos, line, column } = this.currentStream;
		return { pos, line, column, labelSyntax: this.labelSyntax };
	}

	private bufferToken(token: Token, start: TokenStart) {
		this.currentStream.tokenBuffer.push(token);
		this.currentStream.tokenStarts.push(start);
	}

	// Single-pass token extraction with minimal backtracking
	public nextToken(): Token | null {
		this.skipWhitespace();

		if (this.currentStream.pos >= this.currentStream.length) return this.makeToken("EOF", "");

		if (this.endMarker)
			return this.scanRawTextBlock({
				line: this.currentStream.line,
				column: this.currentStream.column,
				hasToGoNextline: true,
			});
		if (this.rawInline) return this.scanRawInline(this.currentStream.line, this.currentStream.column);

		const ch = this.currentStream.source[this.currentStream.pos] as string;
		const startLine = this.currentStream.line;
		const startColumn = this.currentStream.column;

		// Comment - fast path for semicolon
		if (ch === this.commentChar) return this.scanComment(startLine, startColumn);

		// Local labels (':loop') and anonymous labels (':', ':-', ':++', ':+3'): elsewhere, their chars are lexed as usual ('!=')
		if (ch === this.labelSyntax.localPrefix && this.isAlpha(this.peek(1))) return this.scanLocalLabel(startLine, startColumn);
		if (ch === this.labelSyntax.anonMarker) {
			const next = this.peek(1);
			if (next === "+" || next === "-") return this.scanAnonymousLabelRef(startLine, startColumn);
			if (this.isTokenEnd(this.currentStream.pos + 1)) {
				this.advance();
				return this.makeToken("ANONYMOUS_LABEL_DEF", ":", startLine, startColumn);
			}
		}

		// Check for // or /* comments
		if (ch === "/") {
			const next = this.peek(1); // look ahead one char
			if (next === "/") return this.scanComment(startLine, startColumn);
			if (next === "*") return this.scanMultiLineComment(startLine, startColumn);

			// Otherwise it's division operator
			this.advance();
			return this.makeToken("OPERATOR", "/", startLine, startColumn);
		}

		// Multi-character operators
		if (ch === "<" && this.peek(1) === "<") {
			this.advance();
			this.advance();
			return this.makeToken("OPERATOR", "<<", startLine, startColumn);
		}
		if (ch === ">" && this.peek(1) === ">") {
			this.advance();
			this.advance();
			return this.makeToken("OPERATOR", ">>", startLine, startColumn);
		}

		if (ch === "&" && this.peek(1) === "&") {
			this.advance();
			this.advance();
			return this.makeToken("OPERATOR", "&&", startLine, startColumn);
		}
		if (ch === "|" && this.peek(1) === "|") {
			this.advance();
			this.advance();
			return this.makeToken("OPERATOR", "||", startLine, startColumn);
		}
		if (ch === "=" && this.peek(1) === "=") {
			this.advance();
			this.advance();
			return this.makeToken("OPERATOR", "==", startLine, startColumn);
		}
		if (ch === "!" && this.peek(1) === "=") {
			this.advance();
			this.advance();
			return this.makeToken("OPERATOR", "!=", startLine, startColumn);
		}
		if (ch === "<" && this.peek(1) === "=") {
			this.advance();
			this.advance();
			return this.makeToken("OPERATOR", "<=", startLine, startColumn);
		}
		if (ch === ">" && this.peek(1) === "=") {
			this.advance();
			this.advance();
			return this.makeToken("OPERATOR", ">=", startLine, startColumn);
		}

		if (ch === "." && this.peek(1) === "." && this.peek(2) === ".") {
			this.advance();
			this.advance();
			this.advance();
			return this.makeToken("REST_OPERATOR", "...", startLine, startColumn);
		}

		// Single-char tokens - monomorphic check pattern for V8
		switch (ch) {
			case ",":
				this.advance();
				return this.makeToken("COMMA", ",", startLine, startColumn);
			case "#":
				this.advance();
				return this.makeToken("OPERATOR", "#", startLine, startColumn);
			case "(":
				this.advance();
				return this.makeToken("OPERATOR", "(", startLine, startColumn);
			case ")":
				this.advance();
				return this.makeToken("OPERATOR", ")", startLine, startColumn);
			case "[":
				this.advance();
				return this.makeToken("OPERATOR", "[", startLine, startColumn);
			case "]":
				this.advance();
				return this.makeToken("OPERATOR", "]", startLine, startColumn);
			case "+":
				this.advance();
				return this.makeToken("OPERATOR", "+", startLine, startColumn);
			case "*":
				this.advance();
				return this.makeToken("OPERATOR", "*", startLine, startColumn);
			case "&":
				this.advance();
				return this.makeToken("OPERATOR", "&", startLine, startColumn);
			case "|":
				this.advance();
				return this.makeToken("OPERATOR", "|", startLine, startColumn);
			case "=":
				this.advance();
				return this.makeToken("OPERATOR", "=", startLine, startColumn);
			case "^":
				this.advance();
				return this.makeToken("OPERATOR", "^", startLine, startColumn);

			case "!":
				this.advance();
				return this.makeToken("OPERATOR", "!", startLine, startColumn);

			case ".":
				this.advance();
				return this.makeToken("DOT", ".", startLine, startColumn);

			case "{":
				this.advance();
				return this.makeToken("LBRACE", "{", startLine, startColumn);
			case "}":
				this.advance();
				return this.makeToken("RBRACE", "}", startLine, startColumn);
			case "\n":
				this.advance();
				this.currentStream.line++;
				this.currentStream.column = 1;
				return null;
		}

		// Always an operator: whether it's unary is the expression parser's call (UNARY_MINUS).
		if (ch === "-") {
			this.advance();
			return this.makeToken("OPERATOR", "-", startLine, startColumn);
		}

		// String literals
		if (ch === '"' || ch === "'") return this.scanString(startLine, startColumn, ch);

		// Numbers (hex $FF, binary %1010, decimal 42)
		if (this.isDigit(ch) || ch === "$") {
			return this.scanNumber(startLine, startColumn);
		}

		// Handle ambiguity of '%' (binary prefix vs. modulo operator)
		if (ch === "%") {
			const next = this.peek(1);
			if (next === "0" || next === "1") {
				return this.scanNumber(startLine, startColumn);
			}
			// It's not a binary number prefix, so it must be the modulo operator
			this.advance();
			return this.makeToken("OPERATOR", "%", startLine, startColumn);
		}

		// Handle single character comparison operators
		if (ch === "<" || ch === ">") {
			this.advance();
			return this.makeToken("OPERATOR", ch, startLine, startColumn);
		}

		// Identifiers (which could be instructions, labels, or symbols)
		if (this.isIdentifierStart(ch)) {
			return this.scanIdentifier(startLine, startColumn);
		}

		// Unknown character: always an error, never skipped silently. It's reported once read: lexed ahead, it may be
		// lexed again as a label char (see relexFrom)
		const codePoint = this.currentStream.source.codePointAt(this.currentStream.pos) as number;
		const code = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
		const char = String.fromCodePoint(codePoint);
		for (let i = 0; i < char.length; i++) this.advance();
		return this.makeToken("INVALID", `Unexpected character '${char}' (${code}).`, startLine, startColumn);
	}

	private scanComment(_line: number, _column: number) {
		const start = this.currentStream.pos;

		// Skip comment starter (either ';' or '//')
		this.advance();
		if (this.currentStream.source[this.currentStream.pos - 1] === "/" && this.peek() === "/") this.advance(); // skip second '/'

		// Fast scan to end of line using indexOf
		let end = this.currentStream.source.indexOf("\n", this.currentStream.pos);
		if (end === -1) end = this.currentStream.length;

		this.currentStream.pos = end;
		this.currentStream.column += end - start;

		return null;
	}

	private scanMultiLineComment(line: number, column: number) {
		this.advance(); // skip '/'
		this.advance(); // skip '*'

		// Scan until we find '*/'
		while (this.currentStream.pos < this.currentStream.length - 1) {
			if (this.peek() === "*" && this.peek(1) === "/") {
				this.advance(); // skip '*'
				this.advance(); // skip '/'
				return null;
			}

			// Track line numbers within the comment
			if (this.peek() === "\n") {
				this.currentStream.line++;
				this.currentStream.column = 0; // will be incremented by advance()
			}

			this.advance();
		}

		throw new AsmError("Unterminated comment: missing closing */.", { line, column });
	}

	private scanEscapeChar() {
		let value = "";
		this.advance(); // skip escape char
		const escaped = this.peek();
		this.advance(); // consume escaped char
		switch (escaped) {
			case "n":
				value += "\n";
				break;
			case "r":
				value += "\r";
				break;
			case "t":
				value += "\t";
				break;
			case "b":
				value += "\b";
				break;
			case "f":
				value += "\f";
				break;
			case "'":
				value += "'";
				break;
			case '"':
				value += '"';
				break;
			case "\\":
				value += "\\";
				break;
			case "x": {
				const hexCode = this.currentStream.source.substring(this.currentStream.pos, this.currentStream.pos + 2);
				if (hexCode.length === 2 && /^[0-9a-fA-F]+$/.test(hexCode)) {
					value += String.fromCharCode(Number.parseInt(hexCode, 16));
					this.advance();
					this.advance();
				} else {
					value += "x"; // Not a valid hex escape, treat literally
				}
				break;
			}
			default:
				value += escaped; // Unknown escape sequence, treat literally
		}
		return value;
	}

	private scanString(line: number, column: number, delimiter: string): Token {
		let value = "";
		this.advance(); // skip opening "

		while (this.peek() !== delimiter && this.peek() !== "\n" && this.currentStream.pos < this.currentStream.length) {
			if (this.peek() === "\\") value += this.scanEscapeChar();
			else {
				value += this.peek();
				this.advance();
			}
		}

		// A string ends on its line: reaching the end of the line or of the source means the closing quote is missing.
		if (this.peek() !== delimiter) throw new AsmError(`Unterminated string: missing closing ${delimiter}.`, { line, column });
		this.advance(); // skip closing "

		return this.makeToken("STRING", value, line, column, delimiter);
	}

	private scanNumber(line: number, column: number): Token {
		const firstChar = this.peek();
		const secondChar = this.peek(1).toLowerCase();
		const prefixStart = this.currentStream.pos;
		let radix: number;

		// Determine radix and skip prefix
		if (firstChar === "$" || (firstChar === "0" && secondChar === "x")) {
			radix = 16;
			this.advance();
			if (firstChar === "0") this.advance(); // skip 'x'
		} else if (firstChar === "%" || (firstChar === "0" && secondChar === "b" && (this.peek(2) === "0" || this.peek(2) === "1"))) {
			radix = 2;
			this.advance();
			if (firstChar === "0") this.advance(); // skip 'b'
		} else {
			radix = 10;
		}

		const start = this.currentStream.pos;
		while (this.isValidDigitForRadix(this.peek(), radix) || this.peek() === "_") this.advance();

		const numberString = this.currentStream.source.slice(start, this.currentStream.pos).replace(/_/g, "");
		if (numberString === "") {
			// A hex prefix not followed by any digits (e.g. '$', '$x', '0xZZ').
			const prefix = this.currentStream.source.slice(prefixStart, start);
			throw new AsmError(`Invalid number: '${prefix}' must be followed by hexadecimal digits.`, { line, column });
		}

		// A number ends where a word would: '123abc', '0b2' or '$12g' are errors, not a number followed by a symbol.
		if (this.isIdentifierPart(this.peek())) {
			while (this.isIdentifierPart(this.peek())) this.advance();
			const word = this.currentStream.source.slice(prefixStart, this.currentStream.pos);
			throw new AsmError(`Invalid number '${word}'.`, { line, column });
		}

		const numericValue = Number.parseInt(numberString, radix);

		return this.makeToken(
			"NUMBER",
			String(numericValue),
			line,
			column,
			radix === 16 ? `$${numberString}` : radix === 2 ? `%${numberString}` : numberString,
		);
	}

	/** A local label like ':loop'. Its raw text has the prefix: messages name it as written. */
	private scanLocalLabel(line: number, column: number): Token {
		const start = this.currentStream.pos;
		this.advance(); // consume the prefix
		while (this.isIdentifierPart(this.peek())) this.advance();

		const raw = this.currentStream.source.slice(start, this.currentStream.pos);
		return this.makeToken("LOCAL_LABEL", raw.slice(1).toUpperCase(), line, column, raw);
	}

	/** A reference to an anonymous label like ':-' or ':++' or ':+3'. */
	private scanAnonymousLabelRef(line: number, column: number): Token {
		const start = this.currentStream.pos;
		this.advance(); // consume the marker
		const sign = this.peek();
		let count = 0;
		while (this.peek() === sign) {
			this.advance();
			count++;
		}

		// Check for an optional numeric count like ':-3'
		if (this.isDigit(this.peek())) {
			const numStart = this.currentStream.pos;
			while (this.isDigit(this.peek())) this.advance();

			const numStr = this.currentStream.source.slice(numStart, this.currentStream.pos);
			count = Number.parseInt(numStr, 10);
		}

		const value = `${sign}${count}`; // e.g., "-1", "+2", "-3"
		return this.makeToken("ANONYMOUS_LABEL_REF", value, line, column, this.currentStream.source.slice(start, this.currentStream.pos));
	}

	/** True when the char at `pos` ends a token: a space, a comment, or the end of the line or of the source. */
	private isTokenEnd(pos: number): boolean {
		const ch = this.currentStream.source[pos] ?? "";
		return ch === "" || ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || this.isCommentStart(pos);
	}

	private scanRawTextBlock({ line, column, hasToGoNextline }: { line: number; column: number; hasToGoNextline: boolean }): Token | null {
		const endMarkerName = this.endMarker;
		const endMarker = this.endMarker?.toLowerCase();
		const endMarkerLen = this.endMarker?.length || 0;
		this.endMarker = undefined;
		// Reaching the end of the source without the end marker: don't silently take the rest of the file.
		const missingEndMarker = () => new AsmError(`Missing ${endMarkerName} for ${this.rawBlockLabel()}.`, { line, column });
		const scanStart = this.currentStream.pos;

		let rawDataStart: number;
		if (hasToGoNextline) {
			// The raw data starts after the current line.
			const endOfLine = this.currentStream.source.indexOf("\n", this.currentStream.pos);
			// No newline after the directive, so no room for the block and its end marker.
			if (endOfLine === -1) throw missingEndMarker();
			rawDataStart = endOfLine + 1;
		} else {
			rawDataStart = this.currentStream.pos - 1;
		}

		// Find the end marker, which can be preceded by whitespace on its own line.
		// currentPos is the newline before the line being checked: when the data starts on a new line,
		// that's the one ending the directive's line, so the first line of the block is checked too.
		let currentPos = hasToGoNextline ? rawDataStart - 1 : rawDataStart;
		let endOfRawData = -1;

		do {
			let lineStart = currentPos + 1;
			// Skip leading whitespace on the line
			while (lineStart < this.currentStream.length && (this.currentStream.source[lineStart] === " " || this.currentStream.source[lineStart] === "\t"))
				lineStart++;

			const searchSection = this.currentStream.source.slice(lineStart, lineStart + endMarkerLen).toLowerCase();

			// The marker must be a whole word: '.END' matches, '.ENDIF' doesn't.
			const isWholeWord = !this.isIdentifierPart(this.currentStream.source[lineStart + endMarkerLen] ?? "");
			if (searchSection === endMarker && isWholeWord) {
				endOfRawData = currentPos; // The raw data ends at the newline before the end marker line.
				this.currentStream.pos = lineStart + endMarkerLen; // Move position past the end marker
				break;
			}
			currentPos++; // Move to the next character to continue searching
			// biome-ignore lint/suspicious/noAssignInExpressions: easier that way
		} while ((currentPos = this.currentStream.source.indexOf("\n", currentPos)) !== -1);

		if (endOfRawData === -1) throw missingEndMarker();

		this.moveLineAndColumnTo(scanStart, this.currentStream.pos);

		const rawValue = this.currentStream.source.slice(rawDataStart, endOfRawData);

		return this.makeToken("RAW_TEXT", rawValue, line + 1, column);
	}

	/**
	 * Reads raw text on the current line: up to the end of the line, a '}' or a comment, which are left for the
	 * next token. If the text starts with '{', reads up to the matching '}' instead, across lines and comments,
	 * and returns what's between the braces.
	 */
	private scanRawInline(line: number, column: number): Token {
		this.rawInline = false;
		const source = this.currentStream.source;
		const start = this.currentStream.pos;
		let pos = start;

		if (source[pos] !== "{") {
			while (pos < this.currentStream.length && source[pos] !== "\n" && source[pos] !== "}" && !this.isCommentStart(pos)) pos++;
			this.moveLineAndColumnTo(start, pos);
			this.currentStream.pos = pos;
			return this.makeToken("RAW_TEXT", source.slice(start, pos).trimEnd(), line, column);
		}

		pos++; // skip '{'
		while (pos < this.currentStream.length && source[pos] !== "}") {
			if (source[pos] === "/" && source[pos + 1] === "*") {
				const end = source.indexOf("*/", pos + 2);
				pos = end === -1 ? this.currentStream.length : end + 2;
			} else if (this.isCommentStart(pos)) {
				const end = source.indexOf("\n", pos);
				pos = end === -1 ? this.currentStream.length : end;
			} else pos++;
		}
		if (pos >= this.currentStream.length) throw new AsmError(`Missing } for ${this.rawBlockLabel()}.`, { line, column });

		this.moveLineAndColumnTo(start, pos + 1);
		this.currentStream.pos = pos + 1;
		return this.makeToken("RAW_TEXT", source.slice(start + 1, pos), line, column);
	}

	/** After jumping from `from` to `to` in the source, counts the lines skipped so positions stay right. */
	private moveLineAndColumnTo(from: number, to: number) {
		const source = this.currentStream.source;
		let lineStart = -1;
		for (let i = from; i < to; i++) {
			if (source[i] !== "\n") continue;
			this.currentStream.line++;
			lineStart = i + 1;
		}
		if (lineStart === -1) this.currentStream.column += to - from;
		else this.currentStream.column = to - lineStart + 1;
	}

	private scanIdentifier(line: number, column: number): Token {
		let start = this.currentStream.pos;

		// Scan identifier: letters, digits and underscore. A mnemonic suffix (LDA.W) is lexed as LDA, '.', W: the assembler joins them
		while (this.isIdentifierPart(this.peek())) this.advance();

		const value = this.currentStream.source.slice(start, this.currentStream.pos);

		// Check if followed by : - that makes it a label
		if (this.peek() === ":") {
			this.advance(); // consume ':'

			// Check if followed by :: - that makes it a namespace::symbol
			if (this.peek() === ":") {
				this.advance(); // consume ':'

				start = this.currentStream.pos;
				const ch = this.currentStream.source[this.currentStream.pos] as string;
				if (this.isIdentifierStart(ch)) while (this.isIdentifierPart(this.peek())) this.advance();
				const symbolName = this.currentStream.source.slice(start, this.currentStream.pos);

				return this.makeToken("IDENTIFIER", `${value.toUpperCase()}::${symbolName.toUpperCase()}`, line, column, `${value}::${symbolName}`);
			}

			return this.makeToken("LABEL", value.toUpperCase(), line, column, value);
		}

		// Otherwise it's just an identifier (could be instruction, symbol, macro name, etc.)
		return this.makeToken("IDENTIFIER", value.toUpperCase(), line, column, value);
	}

	private isValidDigitForRadix(ch: string, radix: number): boolean {
		if (radix === 16) return this.isHexDigit(ch);
		if (radix === 2) return ch === "0" || ch === "1";
		return this.isDigit(ch); // radix 10
	}

	// Character classification - monomorphic for V8 optimization
	private isDigit(ch: string): boolean {
		return ch >= "0" && ch <= "9";
	}

	private isHexDigit(ch: string): boolean {
		return (ch >= "0" && ch <= "9") || (ch >= "A" && ch <= "F") || (ch >= "a" && ch <= "f");
	}

	private isAlpha(ch: string): boolean {
		return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
	}

	private isAlphaNumeric(ch: string): boolean {
		return this.isAlpha(ch) || this.isDigit(ch);
	}

	private isIdentifierStart(ch: string): boolean {
		return this.isAlpha(ch);
	}

	private isIdentifierPart(ch: string): boolean {
		return this.isAlphaNumeric(ch) || ch === "_";
	}

	public isValidIdentifier(name: string): boolean {
		if (name.length === 0) return false;
		if (!this.isIdentifierStart(name[0] as string)) return false;
		for (let i = 1; i < name.length; i++) if (!this.isIdentifierPart(name[i] as string)) return false;
		return true;
	}

	private skipWhitespace(): void {
		// V8 optimizes simple loops with bounds checks
		while (this.currentStream.pos < this.currentStream.length) {
			const ch = this.currentStream.source[this.currentStream.pos];
			if (ch !== " " && ch !== "\t" && ch !== "\r") break;
			this.advance();
		}
	}

	private peek(offset = 0): string {
		const pos = this.currentStream.pos + offset;
		return pos < this.currentStream.length ? (this.currentStream.source[pos] as string) : "";
	}
	private advance(): void {
		this.currentStream.pos++;
		this.currentStream.column++;
	}
	public getPosition() {
		return { line: this.currentStream.line, column: this.currentStream.column, pos: this.currentStream.pos };
	}

	private makeToken(
		type: Exclude<TokenType, "ARRAY">,
		value: string,
		line = this.currentStream.line,
		column = this.currentStream.column,
		raw?: string,
	): Token {
		return { type, value, line, column, raw } as Token;
	}
}
