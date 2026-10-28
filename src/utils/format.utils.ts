/** A value as `.log` prints it: an array as `[a, b]`, an object as JSON. */
export function formatValue(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map((v) => formatValue(v)).join(", ")}]`;
	if (typeof value === "object") return JSON.stringify(value);

	return String(value);
}
