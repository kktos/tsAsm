import type { LogSink } from "./logsink.interface";

export class ConsoleSink implements LogSink {
	log(message: unknown): void {
		console.log(message);
	}

	warn(message: unknown): void {
		console.warn(message);
	}

	error(message: unknown): void {
		console.error(message);
	}
}
