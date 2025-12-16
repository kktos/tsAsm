export interface LogSink<C> {
	log(message: unknown): void;
	warn(message: unknown): void;
	error(message: unknown): void;

	pushConfig(config: C): void;
	popConfig(): void;
	getConfigDepth(): number;
}
