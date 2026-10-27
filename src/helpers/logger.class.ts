import type { LogSink } from "./logsink.interface";

export class Logger<C = unknown> {
	private readonly sink: LogSink<C>;
	private readonly buffer: unknown[] = [];
	/** The messages held by `hold()`, innermost last. */
	private readonly held: unknown[][] = [];

	public enabled: boolean;
	public cached: boolean;

	constructor(options: { sink: LogSink<C>; enabled?: boolean; cached?: boolean }) {
		this.sink = options.sink;
		this.enabled = options.enabled ?? true;
		this.cached = options.cached ?? false;
	}

	log(message: unknown): void {
		if (!this.enabled) return;

		const held = this.held.at(-1);
		if (held) {
			held.push(message);
			return;
		}

		if (this.cached) {
			this.buffer.push(message);
			return;
		}

		this.sink.log(message);
	}

	// Warnings and errors are shown even when the logger is disabled.
	warn(message: unknown): void {
		this.sink.warn(message);
	}

	error(message: unknown): void {
		this.sink.error(message);
	}

	flush(): void {
		if (!this.enabled || this.buffer.length === 0) return;

		const buf = this.buffer;
		for (let i = 0; i < buf.length; i++) this.sink.log(buf[i]);
		this.buffer.length = 0;
	}

	/** Holds the messages logged from now on, until `release()` gives them back. Holds nest. */
	hold(): void {
		this.held.push([]);
	}

	/** The messages logged since the last `hold()`, which they are no longer held by: log them to write them. */
	release(): unknown[] {
		return this.held.pop() ?? [];
	}

	clear(): void {
		this.buffer.length = 0;
	}

	pushConfig(config: C): void {
		this.sink.pushConfig(config);
	}

	popConfig(): void {
		this.sink.popConfig();
	}

	getConfigDepth(): number {
		return this.sink.getConfigDepth();
	}
}
