import type { LogSink } from "./logsink.interface";

/** Told each message as it's written, enabled or not, with what `site()` gave when it was logged: see `Logger.tap`. */
export interface LogTap {
	site(): unknown;
	write(message: unknown, site: unknown): void;
}

/** A message `hold()` kept while there was a tap, with where it was logged. */
class HeldMessage {
	constructor(
		readonly message: unknown,
		readonly site: unknown,
	) {}
}

export class Logger<C = unknown> {
	private readonly sink: LogSink<C>;
	private readonly buffer: unknown[] = [];
	/** The messages held by `hold()`, innermost last. */
	private readonly held: unknown[][] = [];

	public enabled: boolean;
	public cached: boolean;
	/**
	 * Told the messages as they're written, even while the logger is disabled: the assembler's `onListing`. A held
	 * message keeps the site it was logged at.
	 */
	public tap: LogTap | undefined;

	constructor(options: { sink: LogSink<C>; enabled?: boolean; cached?: boolean }) {
		this.sink = options.sink;
		this.enabled = options.enabled ?? true;
		this.cached = options.cached ?? false;
	}

	/**
	 * `from`: a message `release()` gave, `message` written where it was logged. A released message logged again is
	 * written where it was first logged.
	 */
	log(logged: unknown, from?: unknown): void {
		const message = logged instanceof HeldMessage ? logged.message : logged;
		if (!this.enabled && !this.tap) return;
		const first = logged instanceof HeldMessage ? logged : from;
		const site = first instanceof HeldMessage ? first.site : this.tap?.site();

		const held = this.held.at(-1);
		if (held) {
			held.push(this.tap ? new HeldMessage(message, site) : message);
			return;
		}

		this.tap?.write(message, site);
		if (!this.enabled) return;

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
