import { type Parser, ParserError } from "../assembler/parser.class";
import type { Assembler } from "../assembler/polyasm";
import type { SymbolValue } from "../assembler/symbol.class";
import type { ILister } from "../helpers/lister.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class DefineDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = true;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: ILister,
	) {}

	/**
	 * Reads the directive's line and its block, as a RAW_TEXT token, for a block collector (.macro, .repeat, .if…).
	 * Pass 2 and blocks read again replay the tokens read the first time, the RAW_TEXT token included.
	 */
	getRawBlock(parser: Parser, directive: Token): Token[] {
		if (!parser.isAtUnlexedSource()) {
			const lineTokens = parser.getInstructionTokens(directive);
			const block = parser.peek();
			if (block?.type !== "RAW_TEXT") return lineTokens;
			parser.advance();
			return [...lineTokens, block];
		}

		// Only the directive's line is lexed: a token read past it would be cut from the block.
		const lineTokens: Token[] = [];
		while (!parser.lexer.isRestOfLineBlank() && parser.lexer.nextCharOnLine() !== "}") {
			const token = parser.next();
			if (!token || token.type === "EOF") break;
			lineTokens.push(token);
		}
		// .DEFINE symbol [AS processor] FROM file is inline
		if (lineTokens.findIndex((token) => token.type === "IDENTIFIER" && token.value === "FROM") >= 0) return lineTokens;
		// .DEFINE symbol [AS processor] .... .END is block
		const block = parser.next({ endMarker: ".END", blockName: "DEFINE" });
		return block ? [...lineTokens, block] : lineTokens;
	}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		this.handle(directive, context, 1);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		this.handle(directive, context, 2);
	}

	public handle(directive: ScalarToken, context: DirectiveContext, pass: 1 | 2 = 1) {
		// The name is on the directive's line: a word on the next line is the block's.
		const symbolNameToken = this.assembler.parser.peekTokenUnbuffered();
		if (!symbolNameToken || symbolNameToken.type === "EOF" || symbolNameToken.line !== directive.line)
			throw new ParserError(".DEFINE needs a symbol name.", directive);
		if (symbolNameToken.type !== "IDENTIFIER") throw new ParserError(".DEFINE needs a symbol name.", symbolNameToken);
		this.assembler.parser.next();

		let processorName: string | undefined;
		let fromFile: SymbolValue | undefined;

		while (true) {
			let token = this.assembler.parser.peekTokenUnbuffered();
			if (!token || token.type === "EOF" || token.line !== directive.line) break;

			if (token.type !== "IDENTIFIER") throw new ParserError("Syntax Error - Unexpected token in .DEFINE", directive);

			switch (token.value) {
				case "AS":
					this.assembler.parser.advance();
					token = this.assembler.parser.identifier();
					if (!token) throw new ParserError(".DEFINE requires a Data Processor name.", directive);
					processorName = token.value;
					break;
				case "FROM": {
					this.assembler.parser.advance();
					const expressionTokens = this.assembler.parser.getExpressionTokens();
					fromFile = this.assembler.expressionEvaluator.evaluate(expressionTokens, context);
					if (typeof fromFile !== "string") throw new ParserError(".DEFINE FROM requires a string argument.", directive);
					break;
				}
				default:
					throw new ParserError("Syntax Error - Unknown option in .DEFINE", directive);
			}
		}

		const processor = this.assembler.getDataProcessor(processorName);
		if (!processor) throw new ParserError(`Unknown Data Processor '${processorName}'.`, directive);

		if (pass === 1 && this.assembler.symbolTable.hasSymbolInScope(symbolNameToken.value)) {
			const existing = this.assembler.symbolTable.findSymbol(symbolNameToken.value)?.symbol;
			if (existing) throw this.assembler.symbolTable.redefinitionError(existing);
		}

		let blockContent: string;

		if (fromFile) {
			blockContent = context.readSourceFile?.(fromFile as string, context.filename) ?? "";
		} else {
			let blockToken: Token | null;
			// Extract the raw block content from lexer or from token if included file
			const token = this.assembler.parser.peekTokenUnbuffered();
			if (token?.type === "RAW_TEXT") {
				this.assembler.parser.advance();
				blockToken = token;
			} else {
				blockToken = this.assembler.parser.next({ endMarker: ".END", blockName: "DEFINE" });
			}
			blockContent = (blockToken?.value as string) ?? "";
		}

		const value = processor ? processor(blockContent, context) : blockContent;

		const statement = this.assembler.currentStatement ?? directive;
		if (pass === 1)
			this.assembler.symbolTable.defineVariable(symbolNameToken.value, value, {
				filename: context.filename,
				line: statement.line,
				column: statement.column,
			});
		else this.assembler.symbolTable.assignVariable(symbolNameToken.value, value);

		this.lister.directive(directive, symbolNameToken.value);
	}
}
