/** biome-ignore-all lint/style/noNonNullAssertion: TS compiler doesn't allow unckecked indexed access "noUncheckedIndexedAccess" */
import type { LogSink } from "./logsink.interface";

export class TeeSink<C> implements LogSink<C> {
	private readonly sinks: readonly [LogSink<C>, ...LogSink<C>[]];

	constructor(...sinks: [LogSink<C>, ...LogSink<C>[]]) {
		if (sinks.length === 0) throw new Error("TeeSink requires at least one sink");

		this.sinks = sinks;
	}

	log(message: unknown): void {
		for (let i = 0; i < this.sinks.length; i++) this.sinks[i]!.log(message);
	}

	warn(message: unknown): void {
		for (let i = 0; i < this.sinks.length; i++) this.sinks[i]!.warn(message);
	}

	error(message: unknown): void {
		for (let i = 0; i < this.sinks.length; i++) this.sinks[i]!.error(message);
	}

	pushConfig(config: C): void {
		for (let i = 0; i < this.sinks.length; i++) this.sinks[i]!.pushConfig(config);
	}

	popConfig(): void {
		for (let i = 0; i < this.sinks.length; i++) this.sinks[i]!.popConfig();
	}

	getConfigDepth(): number {
		// All sinks must be in sync; trust the first
		return this.sinks[0].getConfigDepth();
	}
}
