export function formatLogPrefix(pos: { line: number | string; column: number }, source: { filename: string }): string {
	return `[${source.filename}:${pos.line}:${pos.column}] `;
}

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
/** `file:line:column: `, with the parts that are known. */
function formatLocation({ file, line, column }: SourceLocation): string {
	const where = [file, line, column].filter((part) => part !== undefined && part !== "").join(":");
	return where ? `${where}: ` : "";
}

export class AsmError extends Error {
	public location: SourceLocation;
	/** The text of the source line the error is on, when known: shown under the message. */
	public sourceLine?: string;
	/** For an error in a macro body: the macro calls it comes from, innermost first. */
	public macroStack: { name: string; calledAt: SourceLocation }[] = [];

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
	 * and, in a macro body, the calls it comes from: `  in macro M, called at main.asm:9:3`.
	 */
	public format(): string {
		const { line, column } = this.location;
		const lines = [`${formatLocation(this.location)}error: ${this.message}`];

		if (this.sourceLine !== undefined && line !== undefined) {
			const gutter = String(line).padStart(5);
			lines.push(`${gutter} | ${this.sourceLine}`);
			// Tabs are kept so that the caret lines up under the column as the source is shown.
			if (column) lines.push(`${" ".repeat(gutter.length)} | ${this.sourceLine.slice(0, column - 1).replace(/[^\t]/g, " ")}^`);
		}

		for (const call of this.macroStack) lines.push(`  in macro ${call.name}, called at ${formatLocation(call.calledAt).slice(0, -2)}`);
		return lines.join("\n");
	}

	public override toString(): string {
		return this.format();
	}
}
