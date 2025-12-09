export class Logger {
	public enabled = true;
	private warnings: string[] = [];
	private errors: string[] = [];
	private logs: unknown[][] = [];

	constructor(enabled = true) {
		this.enabled = enabled;
	}

	public cache(...args: unknown[]) {
		if (this.enabled) this.logs.push(args);
	}

	public flush() {
		if (this.enabled && this.logs.length > 0) for (const args of this.logs) console.log(...args);
		this.logs = [];
	}

	public log(message: string): void {
		if (this.enabled) console.log(message);
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
