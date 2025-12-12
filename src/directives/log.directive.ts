import type { ScalarToken } from "../shared/lexer/lexer.class";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

export class LogDirective implements IDirective {
	public isBlockDirective = false;
	public isRawDirective = false;

	constructor(
		private readonly runtime: DirectiveRuntime,
		private mode: "LOG" | "ERR" | "WARN" = "LOG",
	) {}

	public handlePassOne(directive: ScalarToken, context: DirectiveContext) {
		this.handle(directive, context);
	}

	public handlePassTwo(directive: ScalarToken, context: DirectiveContext) {
		this.handle(directive, context);
	}

	private handle(directive: ScalarToken, context: DirectiveContext) {
		// Retrieve tokens on the same line after the directive
		const tokens = this.runtime.parser.getInstructionTokens(directive);

		// Split tokens into comma-separated expressions, but respect nested
		// parentheses/brackets/braces so commas inside arrays or function calls
		// don't split top-level directive arguments.
		const exprs: (typeof tokens)[] = [];
		let currentExpr: typeof tokens = [];
		let parenDepth = 0;
		let bracketDepth = 0;
		let braceDepth = 0;

		for (const t of tokens) {
			// Update nesting depths before deciding about commas
			if (t.value === "(") parenDepth++;
			else if (t.value === ")") parenDepth = Math.max(0, parenDepth - 1);
			else if (t.value === "[") bracketDepth++;
			else if (t.value === "]") bracketDepth = Math.max(0, bracketDepth - 1);
			else if (t.value === "{") braceDepth++;
			else if (t.value === "}") braceDepth = Math.max(0, braceDepth - 1);

			const atTopLevel = parenDepth === 0 && bracketDepth === 0 && braceDepth === 0;

			if (t.type === "COMMA" && atTopLevel) {
				exprs.push(currentExpr);
				currentExpr = [];
			} else currentExpr.push(t);
		}
		if (currentExpr.length > 0) exprs.push(currentExpr);

		if (exprs.length === 0) {
			// Nothing to log
			this.emitLog(`.LOG on line ${directive.line}:`);
			return;
		}

		const outputs: string[] = [];

		for (const exprTokens of exprs) {
			// try {
			const value = this.runtime.evaluator.evaluate(exprTokens, context);

			outputs.push(this.formatValue(value));
			// } catch (e) {
			// 	assembler.logger.error(`[LOG] ERROR on line ${directive.line}: ${e}`);
			// 	outputs.push("<ERROR>");
			// }
		}

		this.emitLog(outputs.join("\t"));
	}

	private formatValue(value: unknown): string {
		if (Array.isArray(value)) return `[${value.map((v) => this.formatValue(v)).join(", ")}]`;
		if (typeof value === "object") {
			console.log(value);
			return JSON.stringify(value);
		}

		return String(value);
	}

	private emitLog(message: string): void {
		switch (this.mode) {
			case "ERR":
				throw `${message}`;
			case "WARN":
				this.runtime.logger.warn(message);
				break;
			default:
				this.runtime.logger.log(message);
		}
	}
}
