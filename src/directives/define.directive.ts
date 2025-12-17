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

	getRawBlock(parser: Parser, lineTokens: Token[]): Token | null {
		// .DEFINE symbol [AS processor] FROM file is inline
		if (lineTokens.findIndex((token) => token.type === "IDENTIFIER" && token.value === "FROM") >= 0) return null;
		// .DEFINE symbol [AS processor] .... .END is block
		return parser.next({ endMarker: ".END" });
	}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		this.handle(directive, context, 1);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		this.handle(directive, context, 2);
	}

	public handle(directive: ScalarToken, context: DirectiveContext, pass: 1 | 2 = 1) {
		const symbolNameToken = this.assembler.parser.identifier();
		if (!symbolNameToken) throw new ParserError(".DEFINE requires a symbol name.", directive);

		let processorName: string | undefined;
		let fromFile: SymbolValue | undefined;

		while (true) {
			let token = this.assembler.parser.peekTokenUnbuffered();
			if (!token || token?.line !== directive.line) break;

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

		if (pass === 1 && this.assembler.symbolTable.hasSymbolInScope(symbolNameToken.value))
			throw new ParserError(`Cannot redefine symbol '${symbolNameToken.value}'.`, directive);

		// this.assembler.symbolTable.assignVariable(symbolNameToken.value, 0);

		let blockContent: string;

		if (fromFile) {
			blockContent = context.readSourceFile?.(fromFile as string, context.filename) ?? "";
		} else {
			let blockToken: Token | null;
			// Extract the raw block content from lexer or from token if included file
			// const token = this.assembler.parser.peek();
			const token = this.assembler.parser.peekTokenUnbuffered();
			if (token?.type === "RAW_TEXT") {
				this.assembler.parser.advance();
				blockToken = token;
			} else {
				blockToken = this.assembler.parser.next({ endMarker: ".END" });
			}
			blockContent = (blockToken?.value as string) ?? "";
		}

		const value = processor ? processor(blockContent, context) : blockContent;
		if (pass === 1) this.assembler.symbolTable.defineVariable(symbolNameToken.value, value);
		else this.assembler.symbolTable.assignVariable(symbolNameToken.value, value);

		this.lister.directive(directive, symbolNameToken.value);
	}
}
