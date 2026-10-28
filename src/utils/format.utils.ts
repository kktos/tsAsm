import { RelocValue } from "../assembler/reloc-value.class";

/** A value as `.log` prints it: an array as `[a, b]`, an object as JSON, a relocatable value as `CODE+$0012`. */
export function formatValue(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map((v) => formatValue(v)).join(", ")}]`;
	if (typeof value === "object" && !(value instanceof RelocValue)) return JSON.stringify(value);

	return String(value);
}
