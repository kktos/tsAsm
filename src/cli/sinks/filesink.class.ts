import { createWriteStream, type WriteStream } from "node:fs";
import type { LogSink } from "../../helpers/logsink.interface";

type FileSinkConfig = {
	filename: string;
};

export class FileSink implements LogSink<FileSinkConfig> {
	private readonly stack: FileSinkConfig[] = [];
	private stream!: WriteStream;
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
		this.stream.write(this.format(message));
	}

	warn(message: unknown): void {
		this.stream.write(`[WARN] ${this.format(message)}`);
	}

	error(message: unknown): void {
		this.stream.write(`[ERROR] ${this.format(message)}`);
	}

	private format(message: unknown): string {
		return typeof message === "string" ? `${message}\n` : `${JSON.stringify(message)}\n`;
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
		if (this.stream) this.stream.end();

		// console.log("FileSink.open", `${this.dir}/${filename} ${this.flags}`);

		this.stream = createWriteStream(`${this.dir}/${filename}`, { flags: this.flags });

		// this.log("------ HERE -------");
	}
}
