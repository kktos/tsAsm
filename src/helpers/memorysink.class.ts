import type { LogSink } from "./logsink.interface";

export class MemorySink implements LogSink<null> {
	public logs: string[] = [];
	public warnings: string[] = [];
	public errors: string[] = [];

	log(message: unknown): void {
		this.logs.push(String(message));
	}
	warn(message: unknown): void {
		this.warnings.push(String(message));
	}
	error(message: unknown): void {
		this.errors.push(String(message));
	}
	pushConfig(): void {}
	popConfig(): void {}
	getConfigDepth(): number {
		return 0;
	}
}
