import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken, Token } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import type { Logger } from "./logger.class";

const BYTES_PER_LINE = 8;
const BYTES_PAD = BYTES_PER_LINE * 3;
const CHARS_PAD = BYTES_PER_LINE + 1;
const LABEL_START_COL = BYTES_PAD + 1 + CHARS_PAD + 1 + 4 + 2;
const TEXT_PAD = LABEL_START_COL + 8;
const LABEL_PAD = 16;

type BytesArgs = { addr: number; bytes: number[]; text: string; hasText?: boolean };
type DirectiveBytesArgs = Omit<BytesArgs, "text"> & { pragma: ScalarToken | string; params: SymbolValue[][] };

export class Lister {
	constructor(private logger: Logger) {}

	public bytes({ addr, bytes, text = "", hasText = false }: BytesArgs) {
		let lineText = text;
		for (let i = 0; i < bytes.length; i += BYTES_PER_LINE) {
			const lineAddr = addr + i;
			const addressHex = getHex(lineAddr);
			const lineBytes = bytes.slice(i, i + BYTES_PER_LINE);
			const hexBytes = lineBytes.map((b) => getHex(b)).join(" ");
			const text = hasText ? lineBytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : ".")).join("") : "";

			const header = `${addressHex}: ${hexBytes.padEnd(BYTES_PAD)} ${text.padEnd(CHARS_PAD)}`;

			this.logger.log(`${header.padEnd(TEXT_PAD)} ${lineText}`);

			// Only show comment on the first line
			lineText = "";
		}
	}

	public label(label: string, address: number) {
		this.logger.log(`${getHex(address)}${"".padStart(LABEL_START_COL)}${label}:`);
	}

	public symbol(label: string, value: SymbolValue) {
		this.logger.log(`${"".padStart(LABEL_START_COL)}${label.padEnd(LABEL_PAD)} = ${asString(value)}`);
	}

	public macro(name: string, params: Token[][]) {
		this.logger.log(`${"".padStart(LABEL_START_COL)}${name}(${params.map((p) => p.map((t) => t.value).join("")).join(", ")})`);
	}

	public directive(pragma: ScalarToken | string, ...params: SymbolValue[]) {
		this.logger.log(
			`${"".padStart(TEXT_PAD)}.${(typeof pragma === "string" ? pragma : pragma.value).toLowerCase()} ${params.map((p) => asString(p, true)).join(", ")}`,
		);
	}

	public directiveWithBytes(args: DirectiveBytesArgs) {
		const text = `.${(typeof args.pragma === "string" ? args.pragma : args.pragma.value).toLowerCase()} ${args.params.map((p) => asString(p, true)).join(", ")}`;
		this.bytes({ ...args, text });
	}
}

export function asString(value: SymbolValue, wannaJoinArray = false): string {
	switch (typeof value) {
		case "object":
			if (Array.isArray(value)) {
				if (!wannaJoinArray) return `[${value.map((v) => asString(v)).join(",")}]`;
				return `${value.map((v) => asString(v)).join("")}`;
			}
			if (value && (value as Token).type && (value as Token).column && (value as Token).line && (value as Token).value) {
				switch ((value as Token).type) {
					case "NUMBER":
						return `$${getHex(Number((value as Token).value))}`;
					case "STRING":
						return `"${(value as Token).value}"`;
					case "IDENTIFIER":
						return `${(value as Token).raw}`;
					default:
						return `${(value as Token).value}`;
				}
			}
			return JSON.stringify(value);
		case "number":
			return `$${getHex(value)}`;
		case "string":
			return `"${value}"`;
		default:
			return "";
	}
}
