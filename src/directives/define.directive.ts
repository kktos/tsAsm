import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import type { DirectiveContext, IDirective } from "./directive.interface";

export class DefineDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = true;

	public handlePassOne(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		const symbolNameToken = assembler.parser.identifier();
		if (!symbolNameToken) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a symbol name.`);

		let processorName: string | undefined;

		let token = assembler.parser.peekTokenUnbuffered();
		if (token?.type === "IDENTIFIER" && token.value === "AS") {
			assembler.parser.advance();
			token = assembler.parser.identifier();
			if (!token) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a Data Processor name.`);
			processorName = token.value;
		}

		const processor = assembler.getDataProcessor(processorName);
		if (!processor) throw new Error(`'.DEFINE' directive on line ${directive.line}; unknown Data Processor '${processorName}'.`);

		if (assembler.symbolTable.hasSymbolInScope(symbolNameToken.value)) throw `line ${directive.line}; Cannot redefine symbol '${symbolNameToken.value}'.`;

		// assembler.symbolTable.assignVariable(symbolNameToken.value, 0);

		const blockToken = assembler.parser.next({ endMarker: ".END" });
		const blockContent = (blockToken?.value as string) ?? "";
		const value = processor ? processor(blockContent, context) : blockContent;
		assembler.symbolTable.defineVariable(symbolNameToken.value, value);

		assembler.lister.directive(directive, symbolNameToken.value);
	}

	public handlePassTwo(directive: ScalarToken, assembler: Assembler, context: DirectiveContext) {
		// Parse the directive arguments: .DEFINE <symbolName> <handlerName>
		const symbolNameToken = assembler.parser.identifier();
		if (!symbolNameToken) throw new Error(`'.DEFINE' directive on line ${directive.line} requires a symbol name.`);

		let processorName: string | undefined;

		if (assembler.parser.isIdentifier("AS")) {
			assembler.parser.advance();
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
			assembler.parser.advance();
			blockToken = token;
		} else {
			blockToken = assembler.parser.next({ endMarker: ".END" });
		}

		// Join the raw text of the tokens inside the block.
		const blockContent = (blockToken?.value as string) ?? "";

		// Call the external handler function with the block content
		const value = processor ? processor(blockContent, context) : blockContent;

		// In functions, the scope is lost between the passes
		assembler.symbolTable.assignVariable(symbolNameToken.value, value);

		assembler.lister.directive(directive, symbolNameToken.value);
	}
}
