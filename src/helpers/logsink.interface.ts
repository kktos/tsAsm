export interface LogSink {
	log(message: unknown): void;
	warn(message: unknown): void;
	error(message: unknown): void;
}
