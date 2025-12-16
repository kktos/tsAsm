import type { LogSink } from "./logsink.interface";

export class Logger {
	private readonly sink: LogSink;
	private readonly buffer: unknown[] = [];

	public enabled: boolean;
	public cached: boolean;

	constructor(options: {
		sink: LogSink;
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
		if (!this.enabled) return;
		this.sink.warn(message);
	}

	error(message: unknown): void {
		if (!this.enabled) return;
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
}

/*
export class Logger {
	public enabled: boolean;
	public cached: boolean;
	private warnings: string[] = [];
	private errors: string[] = [];
	private logs: string[] = [];

	constructor(enabled = true, cached = false) {
		this.enabled = enabled;
		this.cached = cached;
	}

	public cache(...args: unknown[]) {
		if (this.enabled) this.logs.push(...(args as string[]));
	}

	public flush() {
		if (this.enabled && this.logs.length > 0) for (const args of this.logs) console.log(args);
		this.logs = [];
	}

	public log(message: string): void {
		if (this.enabled) {
			console.log(message);
			this.cache(message);
		}
	}

	public warn(message: string): void {
		this.warnings.push(message);
		if (this.enabled) console.warn(message);
	}
	public error(message: string): void {
		this.errors.push(message);
		console.error(message);
	}

	public getLogs() {
		return {
			warnings: this.warnings,
			errors: this.errors,
			log: this.logs,
		};
	}
}
*/
