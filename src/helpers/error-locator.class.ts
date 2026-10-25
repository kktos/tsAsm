import type { Parser } from "../assembler/parser.class";
import type { StreamState } from "../assembler/polyasm.types";
import type { MacroHandler } from "../directives/macro/handler";
import type { Token } from "../shared/lexer/lexer.class";
import { AsmError, type DefinitionSite, type IncludeSite } from "../utils/error.utils";
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
		if (error.sourceLine === undefined && typeof location.line === "number")
			error.sourceLine = this.streamManager.getSourceLine(location.file, location.line);
		// The includes lead to the current file: the last place shown, the outermost macro call or else the error itself.
		const lastFile = error.macroStack.at(-1)?.calledAt.file ?? location.file;
		if (error.includeStack.length === 0 && lastFile === this.streamManager.currentFilepath) error.includeStack = this.streamManager.includeStack;
		return error;
	}

	/**
	 * Where an `.include` at `position` is, for the chain of the file it reads: in a macro body, its line in the file
	 * the macro is defined in, then the macro calls that led there.
	 */
	public includeSites(position: { line: number | string; column: number }): IncludeSite[] {
		const { column } = position;
		const site = typeof position.line === "string" ? this.macroSite(position.line) : undefined;
		if (!site) return [{ file: this.streamManager?.currentFilepath, line: position.line, column }];
		return [{ file: site.file, line: site.line, column }, ...site.calls.map(({ name, calledAt }) => ({ ...calledAt, macro: name }))];
	}

	/**
	 * Where something defined at `position` is, for a note about it: in a macro body, its line in the file the macro
	 * is defined in, then the macro calls that led there, before the include chain.
	 */
	public definitionSite(position: { line: number | string; column: number }): DefinitionSite {
		const [location, ...calls] = this.includeSites(position) as [IncludeSite, ...IncludeSite[]];
		return { location, includeStack: [...calls, ...(this.streamManager?.includeStack ?? [])] };
	}

	/** In a macro body, the error is located in the file the macro is defined in, and the macro calls go in its macro stack. */
	private locateInMacro(error: AsmError) {
		const site = this.macroSite(error.location.line as string);
		if (!site) return;
		error.location.file = site.file;
		error.location.line = site.line;
		error.macroStack.push(...site.calls);
	}

	/**
	 * A macro body line is numbered "<call line>.<body line>" ("4.2", "4.3.2" for a nested call): its body line, in
	 * the file the macro is defined in, and the macro calls that led there, innermost first.
	 */
	private macroSite(line: string): { file: string; line: number; calls: AsmError["macroStack"] } | undefined {
		const expansions = this.expansions();
		const definitionFile = (index: number) => {
			const name = expansions[index]?.macroName;
			return name !== undefined ? this.macroHandler.macroDefinitions.get(name)?.file : undefined;
		};
		const bodyLine = (line: number | string) => Number(String(line).split(".").at(-1));

		const innermost = expansions.length - 1;
		const file = definitionFile(innermost);
		if (file === undefined) return undefined;

		// Innermost first: each macro is called from the body of the one before it, or from the current file itself.
		const calls: AsmError["macroStack"] = [];
		for (let index = innermost; index >= 0; index--) {
			const { macroName, macroCall } = expansions[index] as StreamState;
			if (!macroName || !macroCall) continue;
			calls.push({
				name: macroCall.raw ?? macroName,
				calledAt: {
					file: definitionFile(index - 1) ?? this.streamManager?.currentFilepath,
					line: bodyLine(macroCall.line),
					column: macroCall.column,
				},
			});
		}
		return { file, line: bodyLine(line), calls };
	}

	/**
	 * The macro expansions being read, outermost first: those of the current file, pushed after its own stream. A
	 * file included from a macro body is read above that macro's expansion, which belongs to the file including it.
	 */
	private expansions(): StreamState[] {
		const streams = this.parser.tokenStreamStack;
		const file = this.streamManager?.currentFilepath;
		const fileStream = file ? streams.findLastIndex((stream) => stream.file === file) : -1;
		return streams.slice(fileStream + 1).filter((stream) => stream.macroName);
	}
}
