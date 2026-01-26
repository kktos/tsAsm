import type { Parser } from "../assembler/parser.class";
import type { FileHandler } from "../assembler/polyasm.types";

export class StreamManager {
	public currentFilepath = "";
	public currentFilename = "";
	private filenameStack: { path: string; name: string }[] = [];

	constructor(
		private readonly fileHandler: FileHandler,
		private readonly parser: Parser,
	) {}

	public start(source: string, filepath?: string, filename?: string) {
		this.currentFilepath = filepath ?? "";
		this.currentFilename = filename ?? "";
		this.filenameStack = [];
		this.parser.start(source);
	}

	public startNewStream(filename: string, tokenize = true) {
		this.filenameStack.push({ path: this.currentFilepath, name: this.currentFilename });
		const rawContent = this.fileHandler.readSourceFile(filename, this.currentFilepath);
		this.currentFilepath = this.fileHandler.fullpath;
		this.currentFilename = this.fileHandler.filename;
		if (tokenize) this.parser.lexer.startStream(rawContent);
	}

	public endCurrentStream() {
		const file = this.filenameStack.pop();
		if (file) {
			this.currentFilepath = file.path;
			this.currentFilename = file.name;
		} else {
			this.currentFilepath = "";
			this.currentFilename = "";
		}
	}
}
