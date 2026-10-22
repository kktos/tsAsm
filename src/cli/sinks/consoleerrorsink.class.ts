import type { LogSink } from "../../helpers/logsink.interface";
import { AsmError } from "../../utils/error.utils";
import colors from "../colors";

export class ConsoleErrorSink implements LogSink<null> {
	log(_: unknown): void {
		// intentionally no-op
	}

	warn(message: unknown): void {
		console.warn(colors.yellow(message instanceof AsmError ? message.format() : `Warning: ${message}`));
	}

	error(message: unknown): void {
		// An AsmError says "error:" itself, in the `file:line:column: error: message` format editors recognise.
		if (message instanceof AsmError) console.error(colors.red(message.format()));
		else console.error(colors.red(`Error: ${message instanceof Error ? message.message : message}`));
	}

	pushConfig(): void {}
	popConfig(): void {}
	getConfigDepth(): number {
		return 0;
	}
}
