export class Logger {
	public enabled: boolean;
	public cached: boolean;
	private warnings: string[] = [];
	private errors: string[] = [];
	private logs: unknown[] = [];

	constructor(enabled = true, cached = false) {
		this.enabled = enabled;
		this.cached = cached;
	}

	public cache(...args: unknown[]) {
		if (this.enabled) this.logs.push(...args);
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
