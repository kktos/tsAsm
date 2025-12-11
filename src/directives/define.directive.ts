import type { Assembler } from "../assembler/polyasm";
import type { Lister } from "../helpers/lister.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class DefineDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = true;

	constructor(
		private readonly assembler: Assembler,
		private readonly lister: Lister,
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		const symbolNameToken = this.assembler.parser.identifier();
		if (!symbolNameToken) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a symbol name.`);

		let processorName: string | undefined;

		let token = this.assembler.parser.peekTokenUnbuffered();
		if (token?.type === "IDENTIFIER" && token.value === "AS") {
			this.assembler.parser.advance();
			token = this.assembler.parser.identifier();
			if (!token) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a Data Processor name.`);
			processorName = token.value;
		}

		const processor = this.assembler.getDataProcessor(processorName);
		if (!processor) throw new Error(`'.DEFINE' directive on line ${directive.line}; unknown Data Processor '${processorName}'.`);

		if (this.assembler.symbolTable.hasSymbolInScope(symbolNameToken.value)) throw `line ${directive.line}; Cannot redefine symbol '${symbolNameToken.value}'.`;

		// this.assembler.symbolTable.assignVariable(symbolNameToken.value, 0);

		const blockToken = this.assembler.parser.next({ endMarker: ".END" });
		const blockContent = (blockToken?.value as string) ?? "";
		const value = processor ? processor(blockContent, context) : blockContent;
		this.assembler.symbolTable.defineVariable(symbolNameToken.value, value);

		this.lister.directive(directive, symbolNameToken.value);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		// Parse the directive arguments: .DEFINE <symbolName> <handlerName>
		const symbolNameToken = this.assembler.parser.identifier();
		if (!symbolNameToken) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a symbol name.`);

		let processorName: string | undefined;

		if (this.assembler.parser.isIdentifier("AS")) {
			this.assembler.parser.advance();
			const nameToken = this.assembler.parser.identifier();
			if (!nameToken) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a Data Processor name.`);
			processorName = nameToken.value;
		}

		const processor = this.assembler.getDataProcessor(processorName);
		if (!processor) throw new Error(`'.DEFINE' directive on line ${directive.line}; unknown Data Processor '${processorName}'.`);

		// Extract the raw block content from lexer or from token if included file
		let blockToken: Token | null;
		const token = this.assembler.parser.peek();
		if (token?.type === "RAW_TEXT") {
			this.assembler.parser.advance();
			blockToken = token;
		} else {
			blockToken = this.assembler.parser.next({ endMarker: ".END" });
		}

		// Join the raw text of the tokens inside the block.
		const blockContent = (blockToken?.value as string) ?? "";

		// Call the external handler function with the block content
		const value = processor ? processor(blockContent, context) : blockContent;

		// In functions, the scope is lost between the passes
		this.assembler.symbolTable.assignVariable(symbolNameToken.value, value);

		this.lister.directive(directive, symbolNameToken.value);
	}
}
