import type { EventEmitter } from "node:events";
import type { ListingCase, ListingData } from "../assembler/options";
import type { SymbolValue } from "../assembler/symbol.class";
import type { ScalarToken, Token, TokenType } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import type { Logger } from "./logger.class";

const BYTES_PER_LINE = 8;
const BYTES_PAD = BYTES_PER_LINE * 3;
const CHARS_PAD = BYTES_PER_LINE + 1;
const LABEL_START_COL = BYTES_PAD + 1 + CHARS_PAD + 1 + 4 + 2;
const TEXT_PAD = LABEL_START_COL + 8;
const LABEL_PAD = 16;
/** How long a folded data statement's text can be, its end replaced with "…". */
const FOLDED_TEXT_WIDTH = 48;
/** The operand tokens `.option listing.case` applies to: registers and symbols. */
const NAME_TOKENS = new Set<TokenType>(["IDENTIFIER", "LABEL", "LOCAL_LABEL"]);

/** `isCode`: an instruction's bytes, which `listing.data` doesn't fold. */
type BytesArgs = { addr: number; bytes: number[]; text: string; hasText?: boolean; isCode?: boolean };
type DirectiveBytesArgs = Omit<BytesArgs, "text"> & { pragma: ScalarToken | string; params: SymbolValue[][] };

/** A loop being listed. With `listing.data` "fold", its lines are held until it ends, to list it as one data statement if it only emitted data. */
type ListedLoop = {
	/** The loop's header: `.repeat 128 AS idx FROM 0`. */
	text: string;
	/** Whether the header is listed when the loop isn't folded. */
	listsHeader: boolean;
	isFolded: boolean;
	/** The data the loop emitted, while it is one block. */
	addr?: number;
	bytes: number[];
	hasText: boolean;
	/** The lines its data statements logged; a loop that logged others isn't folded. */
	dataLines: number;
	isBlock: boolean;
};

export interface ILister {
	bytes(args: BytesArgs): void;
	label(label: string, address: number): void;
	symbol(label: string, value: SymbolValue): void;
	macro(name: string, params: Token[][]): void;
	directive(pragma: ScalarToken | string, ...params: SymbolValue[]): void;
	directiveWithBytes(args: DirectiveBytesArgs): void;
	beginLoop(text: string, listsHeader: boolean): void;
	endLoop(): void;
}

export class Lister implements ILister {
	private listingCase: ListingCase = "upper";
	private listingData: ListingData = "expand";
	/** The loops being listed, innermost last. */
	private loops: ListedLoop[] = [];

	constructor(
		private logger: Logger,
		emitter: EventEmitter,
	) {
		emitter.on("option:listing.case", (listingCase: ListingCase) => {
			this.listingCase = listingCase;
		});
		emitter.on("option:listing.data", (listingData: ListingData) => {
			this.listingData = listingData;
		});
	}

	/** An instruction's text: its mnemonic, registers and symbols in the case `.option listing.case` asks for, its numbers in hex. */
	public instruction(mnemonic: ScalarToken, operands: ScalarToken[]): string {
		return `${this.cased(mnemonic)} ${operands.map((token) => this.operand(token)).join("")}`;
	}

	private operand(token: ScalarToken): string {
		if (token.type === "NUMBER") return `$${getHex(Number(token.value))}`;
		if (token.type === "ANONYMOUS_LABEL_REF") return token.raw ?? token.value;
		if (NAME_TOKENS.has(token.type)) return this.cased(token);
		return token.value;
	}

	private cased(token: ScalarToken): string {
		const text = token.raw ?? token.value;
		switch (this.listingCase) {
			case "lower":
				return text.toLowerCase();
			case "source":
				return text;
			default:
				return text.toUpperCase();
		}
	}

	/** Bytes, 8 per line, with their text on the first line; data with `listing.data` "fold", the first line only. */
	public bytes({ addr, bytes, text = "", hasText = false, isCode = false }: BytesArgs) {
		const isFolded = this.listingData === "fold" && !isCode;
		const lines = isFolded
			? [this.bytesLine(addr, bytes.slice(0, BYTES_PER_LINE), hasText, bytes.length > BYTES_PER_LINE, cut(text, FOLDED_TEXT_WIDTH))]
			: Array.from({ length: Math.ceil(bytes.length / BYTES_PER_LINE) }, (_, row) => {
					const offset = row * BYTES_PER_LINE;
					// Only show the text on the first line
					return this.bytesLine(addr + offset, bytes.slice(offset, offset + BYTES_PER_LINE), hasText, false, row === 0 ? text : "");
				});

		const loop = this.loops.at(-1);
		if (loop && !isCode) {
			loop.dataLines += lines.length;
			loop.isBlock &&= loop.addr === undefined || loop.addr + loop.bytes.length === addr;
			loop.addr ??= addr;
			loop.bytes.push(...bytes);
			loop.hasText &&= hasText;
		}

		for (const line of lines) this.logger.log(line);
	}

	/** One line of data: the address, up to 8 bytes, as chars too when `hasText`, a "…" when `hasMore` bytes follow, and the text. */
	private bytesLine(addr: number, bytes: number[], hasText: boolean, hasMore: boolean, text: string): string {
		const hexBytes = bytes.map((b) => getHex(b)).join(" ");
		const chars = (hasText ? bytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : ".")).join("") : "") + (hasMore ? "…" : "");
		const header = `${getHex(addr)}: ${hexBytes.padEnd(BYTES_PAD)} ${chars.padEnd(CHARS_PAD)}`;
		return `${header.padEnd(TEXT_PAD)} ${text}`;
	}

	/**
	 * A loop starts. With `listing.data` "fold", its lines are held until `endLoop()`; else its header is listed now,
	 * when `listsHeader`.
	 */
	public beginLoop(text: string, listsHeader: boolean) {
		const isFolded = this.listingData === "fold";
		this.loops.push({ text, listsHeader, isFolded, bytes: [], hasText: true, dataLines: 0, isBlock: true });
		if (isFolded) this.logger.hold();
		else if (listsHeader) this.logger.log(`${"".padStart(TEXT_PAD)}${text}`);
	}

	/**
	 * A loop ends. With `listing.data` "fold", a loop that only emitted a block of data is listed as one data statement,
	 * its header as the text; any other is listed line by line, as it ran.
	 */
	public endLoop() {
		this.closeLoop(true);
	}

	/** Lists the lines of the loops that didn't end (an error stopped the assembly), as they ran. */
	public endLoops() {
		while (this.loops.length > 0) this.closeLoop(false);
	}

	private closeLoop(canFold: boolean) {
		const loop = this.loops.pop();
		if (!loop?.isFolded) return;
		const lines = this.logger.release();

		if (canFold && loop.addr !== undefined && loop.isBlock && lines.length === loop.dataLines) {
			this.bytes({ addr: loop.addr, bytes: loop.bytes, text: loop.text, hasText: loop.hasText });
			return;
		}
		// The enclosing loop sees these lines as not data: it isn't folded either.
		if (loop.listsHeader) this.logger.log(`${"".padStart(TEXT_PAD)}${loop.text}`);
		for (const line of lines) this.logger.log(line);
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

export class NullLister implements ILister {
	public bytes(_args: BytesArgs) {}
	public beginLoop(_text: string, _listsHeader: boolean) {}
	public endLoop() {}
	public label(_label: string, _address: number) {}
	public symbol(_label: string, _value: SymbolValue) {}
	public macro(_name: string, _params: Token[][]) {}
	public directive(_pragma: ScalarToken | string, ..._params: SymbolValue[]) {}
	public directiveWithBytes(_args: DirectiveBytesArgs) {}
}

/** A directive's operands as text: numbers in hex, names as written, spaced like `.repeat 4 AS i FROM 0`, `.for x of [$01, ($02 + $03) * 4]`. */
export function tokensText(tokens: Token[]): string {
	let text = "";
	let isSpaced = false;
	for (const token of tokens) {
		const value = asTokenText(token);
		const isClosing = token.type === "COMMA" || (token.type === "OPERATOR" && (value === ")" || value === "]"));
		if (isSpaced && !isClosing) text += " ";
		text += value;
		isSpaced = token.type !== "FUNCTION" && !(token.type === "OPERATOR" && (value === "(" || value === "["));
	}
	return text;
}

function asTokenText(token: Token): string {
	switch (token.type) {
		case "NUMBER":
			return `$${getHex(Number(token.value))}`;
		case "STRING":
			return `${token.raw ?? '"'}${token.value}${token.raw ?? '"'}`;
		case "COMMA":
			return ",";
		default:
			return String(token.raw ?? token.value);
	}
}

/** `text`, its end replaced with "…" when it's longer than `width`. */
function cut(text: string, width: number): string {
	return text.length > width ? `${text.slice(0, width - 1)}…` : text;
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
