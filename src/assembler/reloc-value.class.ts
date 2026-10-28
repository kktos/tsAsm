import { AsmError } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";

/** The byte `<`, `>` or `^` takes from an address, by its shift: the low one, the high one, the bank. */
export type ByteShift = 0 | 8 | 16;

const BYTE_OPERATORS: Record<ByteShift, string> = { 0: "<", 8: ">", 16: "^" };

/**
 * An address in a relocatable segment: an offset from the segment's start, which has no address until it's loaded.
 * Shown as `CODE+$0012`, and `>CODE+$0012` once `>` took its high byte.
 */
export class RelocValue {
	constructor(
		public readonly segment: string,
		public readonly offset: number,
		/** Set when `<`, `>` or `^` took one byte of it. */
		public readonly byteShift?: ByteShift,
	) {}

	toString(): string {
		const offset = this.offset < 0 ? `-$${getHex(-this.offset, 4)}` : `+$${getHex(this.offset, 4)}`;
		const address = `${this.segment}${offset}`;
		return this.byteShift === undefined ? address : `${BYTE_OPERATORS[this.byteShift]}${address}`;
	}

	/** In an array or an object, as `.log` and the symbol file show them. */
	toJSON(): string {
		return this.toString();
	}
}

/** `value`, which can't be relocatable where it's used: a number is needed, and a relocatable value has none until it's loaded. */
export function notRelocatable<T>(value: T): Exclude<T, RelocValue> {
	if (value instanceof RelocValue) throw new Error(`${value} is relocatable: its address is only known when it's loaded, and a number is needed here.`);
	return value as Exclude<T, RelocValue>;
}

/** An operand's or a data value's: until fixups are recorded, a relocatable value can't be emitted. */
export function noFixupError(value: RelocValue): Error {
	return new Error(`${value} is relocatable, and operands and data can't take one yet: their fixups aren't recorded.`);
}

/** The error for `what` (`Operator '*'`, `.HEX()`) applied to a relocatable value. */
export function relocatableArgumentMessage(what: string, value: RelocValue): string {
	return `${what} can't take ${value}, a relocatable value: it only takes + n, - n, - a label of its segment, and <, > or ^.`;
}

/** One byte of `value`, as `what` (`'<'`, `.LOBYTE()`) at `position` takes it. */
export function relocatableByte(value: RelocValue, shift: ByteShift, what: string, position: { line: number | string; column: number }): RelocValue {
	if (value.byteShift !== undefined) throw AsmError.at(`${what} can't take ${value}: it's already one byte of a relocatable value.`, position);
	return new RelocValue(value.segment, value.offset, shift);
}
