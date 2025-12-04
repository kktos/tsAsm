import type { ScalarToken } from "./lexer/lexer.class";
import type { Logger } from "./logger.class";
import type { SymbolValue } from "./symbol.class";
import { getHex } from "./utils/hex.util";

const BYTES_PER_LINE = 8;
const BYTES_PAD = BYTES_PER_LINE * 3;
const CHARS_PAD = BYTES_PER_LINE + 1;
const LABEL_START_COL = BYTES_PAD + 1 + CHARS_PAD + 1 + 4 + 2;
const TEXT_PAD = LABEL_START_COL + 8;
const LABEL_PAD = 16;

type Args = { addr: number; bytes: number[]; text: string; hasText?: boolean };

export class Lister {
	constructor(private logger: Logger) {}

	public bytes({ addr, bytes, text = "", hasText = false }: Args) {
		let lineText = text;
		for (let i = 0; i < bytes.length; i += BYTES_PER_LINE) {
			const lineAddr = addr + i;
			const addressHex = getHex(lineAddr);
			const lineBytes = bytes.slice(i, i + BYTES_PER_LINE);
			const hexBytes = lineBytes.map((b) => getHex(b)).join(" ");
			const text = hasText ? lineBytes.map((b) => String.fromCharCode(b)).join("") : "";

			const header = `${addressHex}: ${hexBytes.padEnd(BYTES_PAD)} ${text.padEnd(CHARS_PAD)}`;

			this.logger.log(`${header.padEnd(TEXT_PAD)} ${lineText}`);

			// Only show comment on the first line
			lineText = "";
		}
	}

	public label(label: string) {
		this.logger.log(`${"".padStart(LABEL_START_COL)}${label}:`);
	}

	public symbol(label: string, value: SymbolValue) {
		this.logger.log(`${"".padStart(LABEL_START_COL)}${label.padEnd(LABEL_PAD)} = ${asString(value)}`);
	}

	public directive(pragma: ScalarToken, ...params: SymbolValue[]) {
		this.logger.log(`${"".padStart(LABEL_START_COL)}.${pragma.value.toLowerCase()} ${params.join(", ")}`);
	}
}

export function asString(value: SymbolValue): string {
	switch (typeof value) {
		case "object":
			if (Array.isArray(value)) return `[${value.map((v) => asString(v)).join(",")}]`;
			return JSON.stringify(value);
		case "number":
			return `$${getHex(value)}`;
		case "string":
			return `"${value}"`;
		default:
			return "";
	}
}
