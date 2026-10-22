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

	public constructor(message: string, location: SourceLocation = {}) {
		super(message);
		this.name = "AsmError";
		this.location = location;
	}

	/** `file:line:column: error: message`, the format editors and terminals recognise. */
	public format(): string {
		const { file, line, column } = this.location;
		const where = [file, line, column].filter((part) => part !== undefined && part !== "").join(":");
		return `${where ? `${where}: ` : ""}error: ${this.message}`;
	}

	public override toString(): string {
		return this.format();
	}
}
