import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname, join } from "node:path";
import type { LogSink } from "../../helpers/logsink.interface";
import colors from "../colors";

type FileSinkConfig = {
	filename: string;
};

export class FileSink implements LogSink<FileSinkConfig> {
	private readonly stack: FileSinkConfig[] = [];
	private stream: WriteStream | undefined;
	private flags: string;

	constructor(
		private readonly dir: string,
		filename: string,
	) {
		this.flags = "w";
		this.pushConfig({ filename });
		this.flags = "as";
	}

	log(message: unknown): void {
		this.stream?.write(this.format(message));
	}

	warn(message: unknown): void {
		this.stream?.write(`[WARN] ${this.format(message)}`);
	}

	error(message: unknown): void {
		this.stream?.write(`[ERROR] ${this.format(message)}`);
	}

	private format(message: unknown): string {
		// An error has no JSON form: its text (for an AsmError, `file:line:column: error: message`).
		if (typeof message === "string" || message instanceof Error) return `${message}\n`;
		return `${JSON.stringify(message)}\n`;
	}

	pushConfig(config: FileSinkConfig): void {
		this.stack.push(config);
		this.open(config.filename);
	}

	popConfig(): void {
		if (this.stack.length <= 1) throw new Error("Cannot pop initial sink config");

		this.stack.pop();
		const prev = this.stack[this.stack.length - 1];
		if (prev) this.open(prev.filename);
	}
	getConfigDepth() {
		return this.stack.length;
	}

	private open(filename: string): void {
		this.stream?.end();
		this.stream = undefined;

		const path = join(this.dir, filename);

		// A listing that can't be written is reported once, and the assembly goes on without it.
		let reported = false;
		const report = (err: Error) => {
			if (reported) return;
			reported = true;
			console.error(colors.red(`Error: unable to write the listing ${path}: ${err.message}`));
			process.exitCode = 1;
		};

		try {
			mkdirSync(dirname(path), { recursive: true });
			const stream = createWriteStream(path, { flags: this.flags });
			// The file is opened asynchronously: without this listener, a failure kills node with an "Unhandled 'error' event".
			stream.on("error", (err) => {
				if (this.stream === stream) this.stream = undefined;
				report(err);
			});
			this.stream = stream;
		} catch (e) {
			report(e as Error);
		}
	}
}
