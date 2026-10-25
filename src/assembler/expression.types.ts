import type { Segment } from "../linker/linker.class";
import type { Token } from "../shared/lexer/lexer.class";
import type { SymbolValue } from "./symbol.class";

export const PRECEDENCE: Record<string, number> = {
	// Property access has the highest precedence
	PROPERTY_ACCESS: 10,

	// Unary operators (highest precedence)
	UNARY_MINUS: 9,
	"!": 9,
	UNARY_MSB: 9,
	UNARY_LSB: 9,

	// High precedence for array indexing
	ARRAY_ACCESS: 9,

	// Binary operators follow ca65's precedence (https://cc65.github.io/doc/ca65.html#ss5.5).
	// Unlike ca65, `!` stays a high-precedence unary operator (above).

	// Multiplicative, bitwise AND / XOR, shifts
	"*": 8,
	"/": 8,
	"%": 8,
	"&": 8,
	"^": 8,
	"<<": 8,
	">>": 8,

	// Additive, bitwise OR
	"+": 7,
	"-": 7,
	"|": 7,

	// Comparisons
	"<": 6,
	">": 6,
	"<=": 6,
	">=": 6,
	"=": 6,
	"==": 6,
	"!=": 6,

	// Logical AND
	"&&": 5,

	// Logical OR (lowest precedence)
	"||": 4,
};

export type ValueHolder = { value: number };
/**
 * Provides the context needed for the expression evaluator to resolve symbols
 * and the current program counter.
 */

export interface EvaluationContext {
	PC: ValueHolder;
	macroArgs?: Map<string, Token[]>;
	allowForwardRef?: boolean;
	currentLabel?: string | null;
	numberMax?: number;
}

/** What the evaluator asks of the assembler or the linker it evaluates for. */
export interface EvaluatorHost {
	/** A system variable: `.PC`, `.SEGMENT`… */
	resolveSysValue(nameToken: Token): SymbolValue | undefined;
	/** A segment by name, for `.segment(name)`. */
	findSegment(name: string): Segment | undefined;
	/** The anonymous label `distance` labels away from `address`. Without it, there are none. */
	findNearestLabel?(address: number, distance: number): number | null;
	/** Whether a macro is defined at this point, for `.def(name)` / `.undef(name)`. Without it, there are none. */
	isMacroDefined?(name: string): boolean;
}
