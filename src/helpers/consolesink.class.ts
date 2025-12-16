import type { LogSink } from "./logsink.interface";

export class ConsoleSink implements LogSink<null> {
	log(message: unknown): void {
		console.log(message);
	}

	warn(message: unknown): void {
		console.warn(message);
	}

	error(message: unknown): void {
		console.error(message);
	}

	pushConfig(): void {}
	popConfig(): void {}
	getConfigDepth(): number {
		return 0;
	}
}
