/** Where an error is in the source. Any part can be unknown where it's thrown: the assembler fills in what it knows. */
export interface SourceLocation {
	file?: string;
	line?: number | string;
	column?: number;
}

/**
 * The error the assembler reports: what is wrong (`message`) and where (`location`).
 * Code that knows the exact place (a token, a character) gives it; else the assembler uses the statement's.
 */
/** `file:line:column`, with the parts that are known. */
export function describeLocation({ file, line, column }: SourceLocation): string {
	return [file, line, column].filter((part) => part !== undefined && part !== "").join(":");
}

/** The `.include` directives a file was reached through, innermost first. */
export type IncludeStack = readonly SourceLocation[];

/** Another place the error is about, such as the first definition of what is redefined. */
export interface AsmNote {
	message: string;
	location: SourceLocation;
	includeStack: IncludeStack;
}

/** `file:line:column: `, with the parts that are known. */
function formatLocation(location: SourceLocation): string {
	const where = describeLocation(location);
	return where ? `${where}: ` : "";
}

function formatIncludeStack(includeStack: IncludeStack): string[] {
	return includeStack.map((include) => `  included from ${describeLocation(include)}`);
}

export class AsmError extends Error {
	public location: SourceLocation;
	/** The text of the source line the error is on, when known: shown under the message. */
	public sourceLine?: string;
	/** For an error in a macro body: the macro calls it comes from, innermost first. */
	public macroStack: { name: string; calledAt: SourceLocation }[] = [];
	/** The `.include` directives the file of the error (or of its outermost macro call) was reached through. */
	public includeStack: IncludeStack = [];
	/** Other places the error is about, each shown after it as `file:line:column: note: message`. */
	public notes: AsmNote[] = [];
	/** A warning is reported the same way, but doesn't stop the assembly. */
	public severity: "error" | "warning" = "error";

	public constructor(message: string, location: SourceLocation = {}) {
		super(message);
		this.name = "AsmError";
		this.location = location;
	}

	/** An error at a token (or anything with a line and a column): located there, so the caret points at it. */
	public static at(message: string, position: { line: number | string; column: number }): AsmError {
		return new AsmError(message, { line: position.line, column: position.column });
	}

	/**
	 * `file:line:column: error: message`, the format editors and terminals recognise, then the source line with a
	 * caret under the column:
	 * ```
	 * main.asm:3:7: error: Unexpected character '@'
	 *     3 |   lda @x
	 *       |       ^
	 * ```
	 * and, in a macro body, the calls it comes from: `  in macro M, called at main.asm:9:3`;
	 * in an included file, the includes it comes from: `  included from main.asm:2:2`;
	 * then the notes, each with its includes.
	 */
	public format(): string {
		const { line, column } = this.location;
		const lines = [`${formatLocation(this.location)}${this.severity}: ${this.message}`];

		if (this.sourceLine !== undefined && line !== undefined) {
			const gutter = String(line).padStart(5);
			lines.push(`${gutter} | ${this.sourceLine}`);
			// Tabs are kept so that the caret lines up under the column as the source is shown.
			if (column) lines.push(`${" ".repeat(gutter.length)} | ${this.sourceLine.slice(0, column - 1).replace(/[^\t]/g, " ")}^`);
		}

		for (const call of this.macroStack) lines.push(`  in macro ${call.name}, called at ${describeLocation(call.calledAt)}`);
		lines.push(...formatIncludeStack(this.includeStack));

		for (const note of this.notes) lines.push(`${formatLocation(note.location)}note: ${note.message}`, ...formatIncludeStack(note.includeStack));
		return lines.join("\n");
	}

	/** A warning, located and formatted like an error. */
	public static warning(message: string, location: SourceLocation = {}): AsmError {
		const warning = new AsmError(message, location);
		warning.severity = "warning";
		return warning;
	}

	public override toString(): string {
		return this.format();
	}
}
