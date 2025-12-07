import type { ScalarToken, Token } from "../lexer/lexer.class";
import type { Assembler } from "../polyasm";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class DefineDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = true;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, _context: DirectiveContext) {
		const symbolNameToken = assembler.parser.identifier();
		if (!symbolNameToken) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a symbol name.`);

		let processorName: string | undefined;

		let token = assembler.parser.peekTokenUnbuffered();
		if (token?.type === "IDENTIFIER" && token.value === "AS") {
			assembler.parser.consume();
			token = assembler.parser.identifier();
			if (!token) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a Data Processor name.`);
			processorName = token.value;
		}

		const processor = assembler.getDataProcessor(processorName);
		if (!processor) throw new Error(`'.DEFINE' directive on line ${directive.line}; unknown Data Processor '${processorName}'.`);

		assembler.symbolTable.addSymbol(symbolNameToken.value, 0);

		assembler.lister.directive(directive, symbolNameToken.value);

		assembler.parser.next({ endMarker: ".END" });
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		// Parse the directive arguments: .DEFINE <symbolName> <handlerName>
		const symbolNameToken = assembler.parser.identifier();
		if (!symbolNameToken) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a symbol name.`);

		let processorName: string | undefined;

		if (assembler.parser.isIdentifier("AS")) {
			assembler.parser.consume();
			const nameToken = assembler.parser.identifier();
			if (!nameToken) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a Data Processor name.`);
			processorName = nameToken.value;
		}

		const processor = assembler.getDataProcessor(processorName);
		if (!processor) throw new Error(`'.DEFINE' directive on line ${directive.line}; unknown Data Processor '${processorName}'.`);

		// Extract the raw block content from lexer or from token if included file
		let blockToken: Token | null;
		const token = assembler.parser.peek();
		if (token?.type === "RAW_TEXT") {
			assembler.parser.consume();
			blockToken = token;
		} else {
			blockToken = assembler.parser.next({ endMarker: ".END" });
		}

		// Join the raw text of the tokens inside the block.
		const blockContent = (blockToken?.value as string) ?? "";

		// Call the external handler function with the block content
		const value = processor ? processor(blockContent, context) : blockContent;

		// Set the symbol's value to the result
		// assembler.symbolTable.setSymbol(symbolNameToken.value, value);
		if (assembler.symbolTable.isDefined(symbolNameToken.value)) assembler.symbolTable.updateSymbol(symbolNameToken.value, value);
		else assembler.symbolTable.addSymbol(symbolNameToken.value, value);

		// assembler.logger.log(`[PASS 2] Defined symbol ${symbolNameToken.value} via .DEFINE handler '${handlerNameToken.value}'.`);
	}
}
