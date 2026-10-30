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
		const offset = `${this.offset < 0 ? "-" : "+"}$${hexOffset(Math.abs(this.offset))}`;
		const address = `${this.segment}${offset}`;
		return this.byteShift === undefined ? address : `${BYTE_OPERATORS[this.byteShift]}${address}`;
	}

	/** `.segment`, its segment's name, or `.offset`, its offset there: a number, known before it's loaded. */
	field(name: string): string | number {
		if (name !== "segment" && name !== "offset")
			throw new Error(`Property '${name}' does not exist on ${this}: a relocatable value has .segment and .offset.`);
		if (this.byteShift !== undefined) throw new Error(`${this} is one byte of a relocatable address: read .${name} on the address.`);
		return this[name];
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

/** An operand of a CPU that doesn't record fixups (`cpuType`): a relocatable value can't be emitted. */
export function noFixupError(value: RelocValue, cpuType: string): Error {
	return new Error(`${value} is relocatable, and the ${cpuType}'s operands can't take one: their fixups aren't recorded.`);
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

/** An offset on at least 4 digits (`$0012`), more as getHex writes it (`$010000`). */
function hexOffset(offset: number): string {
	return getHex(offset, offset > 0xffff ? undefined : 4);
}
