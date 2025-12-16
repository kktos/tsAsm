import type { LogSink } from "./logsink.interface";

export class Logger<C = unknown> {
	private readonly sink: LogSink<C>;
	private readonly buffer: unknown[] = [];

	public enabled: boolean;
	public cached: boolean;

	constructor(options: {
		sink: LogSink<C>;
		enabled?: boolean;
		cached?: boolean;
	}) {
		this.sink = options.sink;
		this.enabled = options.enabled ?? true;
		this.cached = options.cached ?? false;
	}

	log(message: unknown): void {
		if (!this.enabled) return;

		if (this.cached) {
			this.buffer.push(message);
			return;
		}

		this.sink.log(message);
	}

	warn(message: unknown): void {
		// if (!this.enabled) return;
		this.sink.warn(message);
	}

	error(message: unknown): void {
		// if (!this.enabled) return;
		this.sink.error(message);
	}

	flush(): void {
		if (!this.enabled || this.buffer.length === 0) return;

		const buf = this.buffer;
		for (let i = 0; i < buf.length; i++) this.sink.log(buf[i]);
		this.buffer.length = 0;
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
