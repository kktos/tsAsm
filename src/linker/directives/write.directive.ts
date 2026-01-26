import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import type { ScalarToken } from "../../shared/lexer/lexer.class";

export class WriteDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		const parser = this.runtime.parser;

		if (!parser.isIdentifier(["BYTE", "BYTES", "WORD", "LONG", "STRING", "SEGMENT"])) throw new Error("Invalid write directive");
		const cmd = parser.identifier().value;

		const value = this.runtime.evaluator.evaluate(parser.getExpressionTokens(directive, true), context);

		let offset: number | undefined;

		if (parser.isIdentifier("AT")) {
			parser.advance();
			offset = this.runtime.evaluator.evaluateAsNumber(parser.getExpressionTokens(directive), context);
		}

		switch (cmd) {
			case "STRING":
				if (typeof value !== "string") throw new Error(`Invalid write string directive - ${value} is not a string`);
				this.runtime.linker.emitString(value, offset);
				break;
			case "BYTE":
				if (typeof value !== "number") throw new Error(`Invalid write byte directive - ${value} is not a number`);
				if (value > 0xff || value < 0) throw new Error(`Invalid write byte directive - ${value} should be between 0 and 255`);
				this.runtime.linker.emitByte(value, offset);
				break;
			case "WORD":
				if (typeof value !== "number") throw new Error(`Invalid write word directive - ${value} is not a number`);
				if (value > 0xffff || value < 0) throw new Error(`Invalid write word directive - ${value} should be between 0 and 65535`);
				this.runtime.linker.emitWord(value, offset);
				break;
			case "LONG":
				if (typeof value !== "number") throw new Error(`Invalid write long directive - ${value} is not a number`);
				if (value > 0xffffffff || value < 0) throw new Error(`Invalid write long directive - ${value} should be between 0 and 4294967295`);
				this.runtime.linker.emitLong(value, offset);
				break;
			case "BYTES":
				if (Array.isArray(value) === false) throw new Error(`Invalid write bytes directive - ${value} is not an array`);
				this.runtime.linker.emitBytes(value as number[], offset);
				break;
			case "SEGMENT":
				if (typeof value !== "string") throw new Error(`Invalid write segment directive - ${value} is not a segment name`);
				this.runtime.linker.emitSegment(value, offset);
				break;
		}
	}

	public handlePassOne(_directive: ScalarToken, _context: DirectiveContext) {}
}
