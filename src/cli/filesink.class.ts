import { createWriteStream, type WriteStream } from "node:fs";
import type { LogSink } from "../helpers/logsink.interface";

export class FileSink implements LogSink {
	private stream: WriteStream;

	constructor(path: string) {
		this.stream = createWriteStream(path, { flags: "a" });
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
}
