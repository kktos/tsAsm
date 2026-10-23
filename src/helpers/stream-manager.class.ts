import type { Parser } from "../assembler/parser.class";
import type { FileHandler } from "../assembler/polyasm.types";
import type { IncludeStack } from "../utils/error.utils";

export class StreamManager {
	public currentFilepath = "";
	public currentFilename = "";
	/**
	 * The `.include` directives the current file was reached through, innermost first. A new array for each file
	 * included, never changed: what is defined in the file can keep it.
	 */
	public includeStack: IncludeStack = [];
	private filenameStack: { path: string; name: string; includeStack: IncludeStack }[] = [];
	/** The text of each file read, by path: for errors to show their source line. */
	private sources = new Map<string, string>();

	constructor(
		private readonly fileHandler: FileHandler,
		private readonly parser: Parser,
	) {}

	public start(source: string, filepath?: string, filename?: string) {
		this.currentFilepath = filepath ?? "";
		this.currentFilename = filename ?? "";
		this.filenameStack = [];
		this.includeStack = [];
		this.sources = new Map([[this.currentFilepath, source]]);
		this.parser.start(source);
	}

	/** A line (1-based) of a file read in this assembly, without its line ending (or a leading byte order mark). */
	public getSourceLine(filepath: string, line: number): string | undefined {
		const text = this.sources.get(filepath)?.split("\n")[line - 1];
		return text?.replace(/\r$/, "").replace(/^\uFEFF/, "");
	}

	/** Reads and enters an included file. `includedAt` is where the `.include` directive is, in the current file. */
	public startNewStream(filename: string, tokenize = true, includedAt?: { line: number | string; column: number }) {
		const rawContent = this.fileHandler.readSourceFile(filename, this.currentFilepath);
		this.sources.set(this.fileHandler.fullpath, rawContent);

		// A file already being included would include itself again, forever.
		const includeChain = [...this.filenameStack.map((file) => file.path), this.currentFilepath];
		const cycleStart = includeChain.indexOf(this.fileHandler.fullpath);
		if (cycleStart !== -1) throw new Error(`Include cycle: ${[...includeChain.slice(cycleStart), this.fileHandler.fullpath].join(" -> ")}`);

		this.filenameStack.push({ path: this.currentFilepath, name: this.currentFilename, includeStack: this.includeStack });
		this.includeStack = [{ file: this.currentFilepath, line: includedAt?.line, column: includedAt?.column }, ...this.includeStack];
		this.currentFilepath = this.fileHandler.fullpath;
		this.currentFilename = this.fileHandler.filename;
		if (tokenize) this.parser.lexer.startStream(rawContent);
	}

	public endCurrentStream() {
		const file = this.filenameStack.pop();
		if (file) {
			this.currentFilepath = file.path;
			this.currentFilename = file.name;
			this.includeStack = file.includeStack;
		} else {
			this.currentFilepath = "";
			this.currentFilename = "";
			this.includeStack = [];
		}
	}
}
