import type { Parser } from "../assembler/parser.class";
import type { StreamState } from "../assembler/polyasm.types";
import type { MacroHandler } from "../directives/macro/handler";
import type { Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import type { StreamManager } from "./stream-manager.class";

/**
 * Turns whatever an assembly or a link throws into an AsmError, located: what the error doesn't say about where it
 * is comes from the statement being processed, the file being read and the macro calls being expanded.
 */
export class ErrorLocator {
	constructor(
		private readonly parser: Parser,
		private readonly macroHandler: MacroHandler,
		/** The first token of the statement being processed. */
		private readonly statement: () => Token | undefined,
		/** None when no file is read (a linker without file handler): the errors then have no file and no source line. */
		private readonly streamManager?: StreamManager,
	) {}

	/**
	 * Whatever was thrown, the user gets an AsmError: what is wrong, and where. A location the error doesn't give
	 * is the current statement's (its first token), in the file being read.
	 */
	public toAsmError(e: unknown): AsmError {
		return this.locate(e instanceof AsmError ? e : new AsmError(e instanceof Error ? e.message : String(e)));
	}

	/** A warning, located like an error: at `position`, else at the current statement. */
	public warning(message: string, position?: { line: number | string; column: number }): AsmError {
		return this.locate(AsmError.warning(message, position ? { line: position.line, column: position.column } : {}));
	}

	/** Fills in what the error doesn't say about where it is: the statement, the file, the source line, the macro calls. */
	public locate(error: AsmError): AsmError {
		const { location } = error;
		const statement = this.statement();
		if (location.line === undefined && statement) {
			location.line = statement.line;
			location.column = statement.column;
		} else if (location.column === undefined && location.line === statement?.line) {
			// On the statement's line: its column too.
			location.column = statement?.column;
		}
		if (typeof location.line === "string") this.locateInMacro(error);
		if (!this.streamManager) return error;

		location.file ??= this.streamManager.currentFilepath;
		if (error.sourceLine === undefined && typeof location.line === "number") error.sourceLine = this.streamManager.getSourceLine(location.file, location.line);
		// The includes lead to the current file: the last place shown, the outermost macro call or else the error itself.
		const lastFile = error.macroStack.at(-1)?.calledAt.file ?? location.file;
		if (error.includeStack.length === 0 && lastFile === this.streamManager.currentFilepath) error.includeStack = this.streamManager.includeStack;
		return error;
	}

	/**
	 * A macro body line is numbered "<call line>.<body line>" ("4.2", "4.3.2" for a nested call): the error is
	 * located at the body line, in the file the macro is defined in, and the macro calls go in its macro stack.
	 */
	private locateInMacro(error: AsmError) {
		const expansions = this.parser.tokenStreamStack.filter((stream) => stream.macroName);
		const definitionFile = (index: number) => {
			const name = expansions[index]?.macroName;
			return name !== undefined ? this.macroHandler.macroDefinitions.get(name)?.file : undefined;
		};
		const bodyLine = (line: number | string) => Number(String(line).split(".").at(-1));

		const innermost = expansions.length - 1;
		const file = definitionFile(innermost);
		if (file === undefined) return;
		error.location.file = file;
		error.location.line = bodyLine(error.location.line as string);

		// Innermost first: each macro is called from the body of the one before it, or from the source itself.
		for (let index = innermost; index >= 0; index--) {
			const { macroName, macroCall } = expansions[index] as StreamState;
			if (!macroName || !macroCall) continue;
			error.macroStack.push({
				name: macroCall.raw ?? macroName,
				calledAt: { file: definitionFile(index - 1) ?? this.streamManager?.currentFilepath, line: bodyLine(macroCall.line), column: macroCall.column },
			});
		}
	}
}
