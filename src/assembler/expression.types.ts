import type { Token } from "../shared/lexer/lexer.class";

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

	// Multiplicative
	"*": 8,
	"/": 8,
	"%": 8,

	// Additive
	"+": 7,
	"-": 7,

	// Bitwise shifts
	"<<": 6,
	">>": 6,

	// Relational
	"<": 5,
	">": 5,
	"<=": 5,
	">=": 5,

	// Equality
	"=": 4,
	"==": 4,
	"!=": 4,

	// Bitwise AND
	"&": 3,

	// Logical AND
	"&&": 2,

	// Bitwise XOR
	"^": 1,

	// Bitwise OR / Logical OR (lowest precedence)
	"|": 0,
	"||": 0,
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
