import type { LogSink } from "../../helpers/logsink.interface";
import { AsmError } from "../../utils/error.utils";
import colors from "../colors";

export class ConsoleErrorSink implements LogSink<null> {
	log(_: unknown): void {
		// intentionally no-op
	}

	warn(message: unknown): void {
		console.warn(colors.yellow(`Warning: ${message}`));
	}

	error(message: unknown): void {
		// An AsmError says "error:" itself, in the `file:line:column: error: message` format editors recognise.
		console.error(colors.red(message instanceof AsmError ? message.format() : `Error: ${message}`));
	}

	pushConfig(): void {}
	popConfig(): void {}
	getConfigDepth(): number {
		return 0;
	}
}
