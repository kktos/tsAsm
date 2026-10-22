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
export class AsmError extends Error {
	public location: SourceLocation;
	/** The text of the source line the error is on, when known: shown under the message. */
	public sourceLine?: string;

	public constructor(message: string, location: SourceLocation = {}) {
		super(message);
		this.name = "AsmError";
		this.location = location;
	}

	/**
	 * `file:line:column: error: message`, the format editors and terminals recognise, then the source line with a
	 * caret under the column:
	 * ```
	 * main.asm:3:7: error: Unexpected character '@'
	 *     3 |   lda @x
	 *       |       ^
	 * ```
	 */
	public format(): string {
		const { file, line, column } = this.location;
		const where = [file, line, column].filter((part) => part !== undefined && part !== "").join(":");
		const text = `${where ? `${where}: ` : ""}error: ${this.message}`;
		if (this.sourceLine === undefined || line === undefined) return text;

		const gutter = String(line).padStart(5);
		const lines = [text, `${gutter} | ${this.sourceLine}`];
		// Tabs are kept so that the caret lines up under the column as the source is shown.
		if (column) lines.push(`${" ".repeat(gutter.length)} | ${this.sourceLine.slice(0, column - 1).replace(/[^\t]/g, " ")}^`);
		return lines.join("\n");
	}

	public override toString(): string {
		return this.format();
	}
}
