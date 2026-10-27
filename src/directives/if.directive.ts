import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";

/** What ends a branch at its level: the next branch's directive, or nothing for its `.END` (or its last brace). */
const BRANCHES = ["ELSEIF", "ELSE"];

export class IfDirective implements IDirective {
	isBlockDirective = true;
	isRawDirective = false;

	constructor(private readonly runtime: DirectiveRuntime) {}

	private work(directive: ScalarToken, context: DirectiveContext): void {
		const parser = this.runtime.parser;

		let activeBranch: Token[] | undefined;
		let branchToken: ScalarToken = directive;

		// .IF and each .ELSEIF: a condition is evaluated only while no branch before it was taken.
		while (true) {
			const conditionTokens = parser.getInstructionTokens(branchToken);
			if (!conditionTokens.length) throw AsmError.at("Missing expression.", branchToken);
			const isTaken = !activeBranch && Boolean(this.runtime.evaluator.evaluate(conditionTokens, context));
			const tokens = parser.getDirectiveBlockTokens(branchToken.value, [...BRANCHES]);
			if (isTaken) activeBranch = tokens;
			else this.checkDirectives(tokens);

			const next = this.nextBranch();
			if (!next) break;
			branchToken = next;
			if (next.value === "ELSE") {
				const elseTokens = parser.getDirectiveBlockTokens("ELSE", [...BRANCHES]);
				const after = this.nextBranch();
				if (after) throw AsmError.at(`Unexpected .${after.value}: the .ELSE branch must be the last one.`, after);
				if (activeBranch) this.checkDirectives(elseTokens);
				else activeBranch = elseTokens;
				break;
			}
		}

		if (activeBranch?.length) parser.pushTokenStream({ newTokens: activeBranch, macroArgs: context.macroArgs });
	}

	/**
	 * The .ELSEIF or .ELSE that follows the branch just read, consumed, or undefined at its `.END`. A keyword block
	 * has consumed it as its terminator; after a brace block, it's the next directive (`} .else {`).
	 */
	private nextBranch(): ScalarToken | undefined {
		const parser = this.runtime.parser;
		if (parser.peek(-1)?.type === "RBRACE") {
			if (!parser.isDirective(BRANCHES)) return undefined;
			parser.advance(2);
		} else if (parser.peek(-2)?.type !== "DOT") return undefined;

		const terminator = parser.peek(-1) as ScalarToken;
		return terminator.type === "IDENTIFIER" && BRANCHES.includes(terminator.value) ? terminator : undefined;
	}

	/**
	 * A branch not taken isn't assembled, but a directive that starts one of its statements must exist: a typo
	 * there would otherwise only show when the condition changes. A directive starts a statement at the start of a
	 * line, after a label or after a brace.
	 */
	private checkDirectives(tokens: Token[]) {
		const parser = this.runtime.parser;
		for (let i = 0; i < tokens.length - 1; i++) {
			const dot = tokens[i] as Token;
			const name = tokens[i + 1] as Token;
			if (dot.type !== "DOT" || name.type !== "IDENTIFIER") continue;
			if (tokens[i + 2]?.type === "OPERATOR" && tokens[i + 2]?.value === "(") continue;

			const previous = tokens[i - 1];
			const startsStatement = !previous || previous.line !== dot.line || ["LBRACE", "RBRACE", "LABEL", "LOCAL_LABEL"].includes(previous.type);
			if (!startsStatement) continue;

			const directiveName = name.value as string;
			if (!parser.isKnownDirective(directiveName) && !BRANCHES.includes(directiveName))
				throw AsmError.at(`Syntax error - Unexpected directive '${directiveName}'`, name);
		}
	}

	handlePassOne(directive: ScalarToken, context: DirectiveContext): void {
		this.work(directive, context);
	}
	handlePassTwo(directive: ScalarToken, context: DirectiveContext): void {
		this.work(directive, context);
	}
}
