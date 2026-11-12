import type { RelocValue } from "../assembler/reloc-value.class";
import type { Endianness } from "../cpu/cpuhandler.interface";
import type { Linker } from "../linker/linker.class";
import type { Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { assertFitsInBytes } from "../utils/number.utils";

/** The bytes of a number of `size` bytes, in the CPU's byte order. */
export function elementBytes(value: number, size: number, endianness: Endianness): number[] {
	const bytes = Array.from({ length: size }, (_, i) => (value >> (i * 8)) & 0xff);
	return endianness === "big" ? bytes.reverse() : bytes;
}

/** A whole relocatable address fills an element: a byte takes one byte of it. `description` says what the value is (`.DB value:`). */
export function checkRelocatableElement(value: RelocValue, size: number, description: string, at: Token) {
	if (size === 1 && value.byteShift === undefined) throw AsmError.at(`${description} ${value} is a whole address: take one byte of it with <, > or ^.`, at);
}

/**
 * The element of `size` bytes holding a relocatable value, written at `addr`: its offset, or the byte `<`, `>` or `^` took,
 * zero-extended (`.dw <label`). Its fixup covers the element, or only that byte: the low one, first in little-endian, last in big-endian.
 */
export function relocatableElement(
	linker: Linker,
	value: RelocValue,
	element: { size: number; endianness: Endianness; addr: number },
	description: string,
	at: Token,
): number[] {
	const { size, endianness, addr } = element;
	checkRelocatableElement(value, size, description, at);
	const { byteShift } = value;
	if (byteShift === undefined) {
		assertFitsInBytes(value.offset, size, description);
		linker.addFixup(addr, size, value);
		return elementBytes(value.offset, size, endianness);
	}
	const byteAt = endianness === "big" ? size - 1 : 0;
	linker.addFixup(addr + byteAt, 1, value);
	return elementBytes((value.offset >> byteShift) & 0xff, size, endianness);
}
