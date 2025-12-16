export function formatLogPrefix(pos: { line: number | string; column: number }, source: { filename: string }): string {
	return `[${source.filename}:${pos.line}:${pos.column}] `;
}
