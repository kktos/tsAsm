import type { LogSink } from "../../helpers/logsink.interface";
import colors from "../colors";

export class ConsoleErrorSink implements LogSink<null> {
	log(_: unknown): void {
		// intentionally no-op
	}

	warn(message: unknown): void {
		console.warn(colors.yellow(`Warning: ${message}`));
	}

	error(message: unknown): void {
		console.error(colors.red(`Error: ${message}`));
	}

	pushConfig(): void {}
	popConfig(): void {}
	getConfigDepth(): number {
		return 0;
	}
}
