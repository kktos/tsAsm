/**
 * expression.ts
 * * Defines the expression evaluation engine for the assembler.
 * * Uses the Shunting-Yard algorithm for precedence and parentheses.
 */

import type { PASymbolTable, SymbolValue } from "../assembler/symbol.class";
import { FunctionDispatcher } from "../shared/functions/function.dispatcher";
import type { FunctionToken, OperatorStackToken, OperatorToken, ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError, type AsmNote } from "../utils/error.utils";
import { nestingDelta } from "../utils/token.utils";
import { type EvaluationContext, type EvaluatorHost, PRECEDENCE } from "./expression.types";
import { DEFAULT_OPTIONS } from "./options";
import { type ByteShift, notRelocatable, RelocValue, relocatableArgumentMessage, relocatableByte } from "./reloc-value.class";
import { UserFunction } from "./user-function.class";

const UNARY_TEST_OPERATORS = new Set([")", "]"]);
// What two strings do as text: `+` joins them, the others compare them.
const STRING_OPERATORS = new Set(["+", "=", "==", "!="]);

/** A one-character string used as a number is its character code: `"A"+1` is $42. Anything else is returned as is. */
const charCode = <T>(value: T): T | number => (typeof value === "string" && value.length === 1 ? value.charCodeAt(0) : value);
const notACharMessage = (value: string) => `Only a one-character string can be used as a number: ${JSON.stringify(value)}.`;
const UNARY_OPERATORS = new Set(["UNARY_MINUS", "!", "UNARY_LSB", "UNARY_MSB", "UNARY_BANK"]);
/** The byte `<`, `>` and `^` take, by their shift. */
const BYTE_SHIFTS: Record<string, ByteShift> = { UNARY_LSB: 0, UNARY_MSB: 8, UNARY_BANK: 16 };
/** A unary operator as written, for messages. */
const UNARY_SYMBOLS: Record<string, string> = { UNARY_MINUS: "-", "!": "!", UNARY_LSB: "<", UNARY_MSB: ">", UNARY_BANK: "^" };

/** A system function's (`.len(`) or a user function's (`screen(`), on the operator stack until its `)`. */
const isCall = (token: Token | undefined): token is FunctionToken => token?.type === "FUNCTION" || token?.type === "USER_FUNCTION";

/** `name(`, the `(` glued to the name, is a call, as a macro's `m(1, 2)`: `name (1)` isn't. */
const opensCall = (name: Token, next: Token | undefined) =>
	next?.type === "OPERATOR" && next.value === "(" && next.line === name.line && next.column === name.column + String(name.raw ?? name.value).length;

export class ExpressionEvaluator {
	public readonly functionDispatcher: FunctionDispatcher;
	/** The user functions being called, each with how many of its calls are running: see `callFunction`. */
	private readonly runningCalls = new Map<UserFunction, number>();
	/** The errors already given the note of the function they're in: only the innermost function's. */
	private readonly notedErrors = new WeakSet<AsmError>();

	constructor(
		private readonly symbolTable: PASymbolTable,
		private readonly host: EvaluatorHost,
	) {
		this.functionDispatcher = new FunctionDispatcher(host);
	}

	/**
	 * Resolves an array of tokens into a single numeric value using the
	 * Shunting-Yard algorithm for precedence and RPN evaluation.
	 */
	public evaluate(tokens: Token[], context: EvaluationContext): SymbolValue {
		if (tokens.length === 0) throw new Error("Missing expression.");

		const rpnTokens = this.infixToRPN(tokens, context);
		return this.evaluateRPN(rpnTokens, context);
	}

	/**
	 * A wrapper for evaluate that ensures the result is a number.
	 * Throws an error if the expression evaluates to a string or array.
	 * A one-character string is its character code: `lda #"A"`.
	 */
	public evaluateAsNumber(tokens: Token[], context: EvaluationContext) {
		return this.asNumber(notRelocatable(this.evaluate(tokens, context)));
	}

	/** An instruction's operand: a number, as `evaluateAsNumber`, or a relocatable value, whose fixup is recorded. */
	public evaluateOperand(tokens: Token[], context: EvaluationContext): number | RelocValue | null {
		const value = this.evaluate(tokens, context);
		return value instanceof RelocValue ? value : this.asNumber(value);
	}

	private asNumber(value: SymbolValue) {
		const result = charCode(value);

		if (typeof result === "string") throw new Error(notACharMessage(result));
		if (result !== null && typeof result !== "number") throw new Error("Expression did not evaluate to a number as expected.");

		return result;
	}

	/**
	 * Evaluates the contents of an array literal.
	 * e.g., [ "red", "green", 1+2 ]
	 */
	private evaluateArray(tokens: Token[], context: EvaluationContext): SymbolValue[] {
		const elements: SymbolValue[] = [];
		if (tokens.length === 0) return elements;
		let currentExpression: Token[] = [];

		// An empty element (`[1,,2]`, `[1,]`) is evaluated too: `Missing expression.`, as `.db 1,`.
		const evaluateAndPush = () => {
			elements.push(this.evaluate(currentExpression, context));
			currentExpression = [];
		};

		// Only commas at the top level separate elements: not those of a nested array or of a function call.
		let depth = 0;
		for (const token of tokens) {
			if (token.type === "OPERATOR" && (token.value === "(" || token.value === "[")) depth++;
			else if (token.type === "OPERATOR" && (token.value === ")" || token.value === "]")) depth--;

			if (token.type === "COMMA" && depth === 0) {
				evaluateAndPush();
			} else {
				currentExpression.push(token);
			}
		}
		evaluateAndPush(); // Push the last element
		return elements;
	}

	/** Handles comma tokens, used as separators in function arguments. */
	private handleComma(token: Token, outputQueue: Token[], operatorStack: Token[], lastToken: Token | undefined): void {
		// A comma separates arguments, so we evaluate the expression for the current argument.
		while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1]?.value !== "(") outputQueue.push(operatorStack.pop() as Token);

		// Ensure the comma is inside a function call.
		let foundParen = false;
		for (let k = operatorStack.length - 1; k >= 0; k--) {
			if (operatorStack[k]?.value === "(") {
				foundParen = true;
				// Increment argument count of the function, which is right before the '('.
				if (k > 0 && isCall(operatorStack[k - 1])) {
					const funcToken = operatorStack[k - 1] as Token;
					// Safely increment argCount
					funcToken.argCount = (funcToken.argCount ?? 0) + 1;
				}
				break;
			}
		}
		if (!foundParen) throw AsmError.at("Unexpected comma.", token);

		// An argument can't be empty: `.f(,1)`, `.f(1,,2)`.
		if (lastToken?.type === "COMMA" || (lastToken?.type === "OPERATOR" && lastToken.value === "(")) throw AsmError.at("Missing expression.", token);
	}

	/** Handles all operator tokens, including parentheses and unary operators. Returns a potentially modified token. */
	private handleOperator(token: OperatorToken, outputQueue: Token[], operatorStack: OperatorStackToken[], lastToken: Token | undefined): Token {
		const op = token.value;
		// An operand starts the expression, an argument (after a comma) or follows an operator.
		const isUnary =
			!lastToken ||
			lastToken.type === "COMMA" ||
			(lastToken.type === "OPERATOR" && (lastToken.value === "(" || !UNARY_TEST_OPERATORS.has(lastToken.value as string)));

		switch (op) {
			case "[": // Array access
				operatorStack.push({ ...token, value: "ARRAY_ACCESS" });
				operatorStack.push({ ...token, value: "(" }); // Virtual '(' for index expression.
				break;

			case "]": {
				// Closing bracket for array access
				let foundParen = false;
				while (operatorStack.length > 0) {
					const topOp = operatorStack.pop() as Token;
					if (topOp.value === "(") {
						foundParen = true;
						break;
					}
					outputQueue.push(topOp);
				}
				if (!foundParen) throw AsmError.at(`Mismatched brackets: unmatched ']'.`, token);

				const arrayAccessOp = operatorStack.pop();
				if (arrayAccessOp?.value !== "ARRAY_ACCESS") throw AsmError.at(`Mismatched brackets: ']' without preceding array access.`, token);

				outputQueue.push(arrayAccessOp);
				break;
			}
			case ".":
				break;

			case "-":
			case "+":
				if (isUnary) {
					if (op === "-") {
						const unaryToken: OperatorToken = {
							...token,
							value: "UNARY_MINUS",
						};
						// A prefix operator has no left operand: it never pops another operator still waiting
						// for its operand, so it's pushed as is (`-<x` is -(<x)).
						operatorStack.push(unaryToken);
					}
					// Unary '+' is a no-op, so we do nothing.
				} else {
					this.pushOperatorWithPrecedence(token, outputQueue, operatorStack);
				}
				break;

			case "!":
				if (!isUnary) throw AsmError.at(`Operator '!' must be unary.`, token);
				operatorStack.push(token); // prefix operator, see UNARY_MINUS
				break;

			case "*":
				if (isUnary) {
					// This is the program counter symbol, not multiplication. Treat as an identifier.
					const pcToken = { ...token, type: "IDENTIFIER" as const };
					outputQueue.push(pcToken);
					return pcToken; // Return the modified token
				}
				this.pushOperatorWithPrecedence(token, outputQueue, operatorStack);
				break;

			case "<":
				if (isUnary) {
					const unaryToken: OperatorToken = { ...token, value: "UNARY_LSB" };
					operatorStack.push(unaryToken); // prefix operator, see UNARY_MINUS
					break;
				}
				this.pushOperatorWithPrecedence(token, outputQueue, operatorStack);
				break;

			case ">":
				if (isUnary) {
					const unaryToken: OperatorToken = { ...token, value: "UNARY_MSB" };
					operatorStack.push(unaryToken); // prefix operator, see UNARY_MINUS
					break;
				}
				this.pushOperatorWithPrecedence(token, outputQueue, operatorStack);
				break;

			case "^":
				if (isUnary) {
					const unaryToken: OperatorToken = { ...token, value: "UNARY_BANK" };
					operatorStack.push(unaryToken); // prefix operator, see UNARY_MINUS
					break;
				}
				this.pushOperatorWithPrecedence(token, outputQueue, operatorStack);
				break;

			case "(":
				operatorStack.push(token);
				break;

			case ")": {
				// Nor the last one: `.f(1,)`.
				if (lastToken?.type === "COMMA") throw AsmError.at("Missing expression.", token);

				let foundMatch = false;
				while (operatorStack.length > 0) {
					const topOp = operatorStack.pop() as Token;
					if (topOp.value === "(") {
						foundMatch = true;
						break;
					}
					outputQueue.push(topOp);
				}
				if (!foundMatch) throw AsmError.at(`Mismatched parenthesis: unmatched ')'.`, token);

				// If the token before the '(' was a function, pop it to the output.
				const topOfStack = operatorStack[operatorStack.length - 1];
				if (isCall(topOfStack)) {
					const funcToken = operatorStack.pop() as Token;
					// If there's only one argument and it's empty (e.g., .FOO()), arg count is 0.
					if (funcToken.argCount === 1 && lastToken?.value === "(") {
						funcToken.argCount = 0;
					}
					outputQueue.push(funcToken);
				}
				break;
			}

			default: // Default case for all other binary operators
				this.pushOperatorWithPrecedence(token, outputQueue, operatorStack);
				break;
		}
		return token;
	}

	/** Helper function to handle operator precedence during Shunting-Yard. */
	private pushOperatorWithPrecedence(token: OperatorStackToken, outputQueue: Token[], operatorStack: OperatorStackToken[]): void {
		const currentPrecedence = PRECEDENCE[token.value] ?? 0;

		while (operatorStack.length > 0) {
			const topOp = operatorStack[operatorStack.length - 1] as OperatorStackToken;
			if (topOp.value === "(") break;

			const topPrecedence = PRECEDENCE[topOp.value] ?? 0;

			if (topPrecedence >= currentPrecedence) {
				outputQueue.push(operatorStack.pop() as Token);
			} else {
				break;
			}
		}
		operatorStack.push(token);
	}

	/**
	 * Whether the identifier between `previous` and `next` is a whole argument that its function takes as a name,
	 * `X` in `.def(X)`: see `IFunctionDef.nameArgs`. Not in `.def((X))`, whose `(` isn't the function's.
	 */
	private isNameArgument(next: Token | undefined, previous: Token | undefined, operatorStack: OperatorStackToken[]): boolean {
		const endsArgument = next?.type === "COMMA" || (next?.type === "OPERATOR" && next.value === ")");
		const startsArgument = previous?.type === "COMMA" || (previous?.type === "OPERATOR" && previous.value === "(");
		if (!endsArgument || !startsArgument || operatorStack.at(-1)?.value !== "(") return false;

		const funcToken = operatorStack.at(-2);
		if (funcToken?.type !== "FUNCTION") return false;
		// A comma already counted the argument it starts.
		return this.functionDispatcher.isNameArgument(funcToken.value, (funcToken.argCount ?? 1) - 1);
	}

	/** Converts an infix token stream to Reverse Polish Notation (RPN). */
	private infixToRPN(tokens: Token[], context: EvaluationContext) {
		const outputQueue: Token[] = [];
		const operatorStack: (OperatorToken | FunctionToken)[] = [];
		let lastToken: Token | undefined;

		for (let index = 0; index < tokens.length; index++) {
			let processedToken = tokens[index]; // Use a mutable token for processing

			// --- Array Literal Parsing (only if not preceded by an operand) ---
			// This block handles `[1,2,3]`
			const isPrecededByOperand =
				lastToken &&
				(lastToken.type === "NUMBER" ||
					lastToken.type === "STRING" ||
					lastToken.type === "IDENTIFIER" ||
					lastToken.type === "PROPERTY_ACCESS" ||
					lastToken.type === "LABEL" ||
					lastToken.type === "LOCAL_LABEL" ||
					lastToken.type === "ANONYMOUS_LABEL_REF" ||
					lastToken.type === "ARRAY" ||
					lastToken.value === ")" || // closing parenthesis of a sub-expression
					lastToken.value === "]"); // closing bracket of an array access: `t[1][0]` indexes again

			if (processedToken?.type === "OPERATOR" && processedToken.value === "[" && !isPrecededByOperand) {
				// Array literal detection: its closing `]` is an operator, a string "]" isn't one.
				let balance = 1;
				let j = index + 1;
				for (; j < tokens.length; j++) {
					balance += nestingDelta(tokens[j] as Token);
					if (balance === 0) break;
				}

				if (balance !== 0) throw AsmError.at("Mismatched brackets in array literal.", processedToken);

				const arrayContentTokens = tokens.slice(index + 1, j);
				const arrayValue = this.evaluateArray(arrayContentTokens, context);
				const arrayToken: Token = {
					type: "ARRAY",
					line: processedToken.line,
					column: processedToken.column,
					value: arrayValue, // Assign the evaluated array directly to the 'value' field
				};
				outputQueue.push(arrayToken);
				index = j; // Move index past the array
				lastToken = arrayToken;
				continue;
			}

			switch (processedToken?.type) {
				case "IDENTIFIER": {
					// An operand should not follow another operand without an operator in between.
					if (lastToken && lastToken.type !== "OPERATOR" && lastToken.type !== "COMMA" && lastToken.value !== "(")
						throw AsmError.at(`Invalid expression format: Unexpected token '${processedToken.value}'.`, processedToken);

					if (this.isNameArgument(tokens[index + 1], lastToken, operatorStack)) {
						processedToken = { ...processedToken, type: "SYMBOL_NAME" };
						outputQueue.push(processedToken);
						break;
					}

					if (opensCall(processedToken, tokens[index + 1])) {
						const callToken: FunctionToken = { ...processedToken, type: "USER_FUNCTION", argCount: 1 };
						operatorStack.push(callToken);
						lastToken = callToken;
						continue;
					}

					outputQueue.push(processedToken);
					break;
				}
				case "NUMBER":
				case "STRING":
				case "LABEL":
				case "LOCAL_LABEL":
				case "ANONYMOUS_LABEL_REF":
				case "ARRAY":
					// An operand should not follow another operand without an operator in between.
					if (lastToken && lastToken.type !== "OPERATOR" && lastToken.type !== "COMMA" && lastToken.value !== "(")
						throw AsmError.at(`Invalid expression format: Unexpected token '${processedToken.value}'.`, processedToken);

					outputQueue.push(processedToken);
					break;

				case "COMMA":
					this.handleComma(processedToken, outputQueue, operatorStack, lastToken);
					break;

				case "DOT": {
					const isUnary = !lastToken || (lastToken.type === "OPERATOR" && lastToken.value !== "]") || lastToken.type === "COMMA";
					const nextToken = tokens[index + 1];

					if (nextToken?.type !== "IDENTIFIER") throw AsmError.at(`Invalid syntax: '.' must be followed by an identifier.`, processedToken);

					if (isUnary) {
						// Check for function call, e.g., IDENTIFIER followed by '('.
						if (tokens[index + 2]?.value === "(") {
							// Known before its arguments are read: `.min(1,,2)` is an unknown function, not an empty argument.
							if (!this.functionDispatcher.has(nextToken.value as string))
								throw AsmError.at(`Unknown function '${(nextToken.value as string).toUpperCase()}'.`, nextToken);
							const funcToken: FunctionToken = {
								...nextToken,
								type: "FUNCTION",
								argCount: 1, // Default to 1 for the first argument.
							};
							operatorStack.push(funcToken);
							lastToken = funcToken;
							index += 1;
							continue;
						}

						// This is a system variable, e.g., .PC or .SEGMENT
						const sysVarToken: Token = {
							type: "SYSVAR",
							value: nextToken.value,
							line: processedToken.line,
							column: processedToken.column,
						};
						outputQueue.push(sysVarToken);
						lastToken = sysVarToken;
					} else {
						// This is a property access on an object, e.g., myObj.prop
						const propertyAccessToken: ScalarToken = {
							type: "PROPERTY_ACCESS",
							value: nextToken.raw as string,
							line: processedToken.line,
							column: processedToken.column,
						};
						outputQueue.push(propertyAccessToken);
						lastToken = propertyAccessToken;
					}

					index++; // Skip the identifier token
					continue;
				}

				case "OPERATOR":
					processedToken = this.handleOperator(processedToken as OperatorToken, outputQueue, operatorStack, lastToken);
					break;
			}
			lastToken = processedToken; // Always update lastToken
		}

		while (operatorStack.length > 0) {
			const op = operatorStack.pop() as Token;
			if (op.value === "(" || op.value === ")") throw new Error(`Mismatched parenthesis: unmatched '(' left in stack.`);

			outputQueue.push(op);
		}

		return outputQueue;
	}

	/** Evaluates a Reverse Polish Notation (RPN) token stream. */
	private evaluateRPN(rpnTokens: Token[], context: EvaluationContext): SymbolValue {
		const stack: (SymbolValue | null)[] = [];

		for (const token of rpnTokens) {
			switch (token.type) {
				case "NUMBER": {
					const num = Number.parseFloat(token.value);
					stack.push(num);
					break;
				}

				case "STRING":
					stack.push(token.value);
					break;

				case "ARRAY":
					stack.push(token.value);
					break;

				case "IDENTIFIER":
				case "LABEL":
				case "LOCAL_LABEL":
				case "ANONYMOUS_LABEL_REF": {
					// resolveValue handles all symbol, macro arg, and special value lookups.
					const value = this.resolveValue(token, context);
					stack.push(value);
					break;
				}

				case "SYMBOL_NAME": {
					// A macro parameter stands for its argument: `.def(p)` with `m X` is `.def(X)`.
					const argTokens = context.macroArgs?.get(token.value);
					if (!argTokens) stack.push(token.value);
					else if (argTokens.length === 1 && argTokens[0]?.type === "IDENTIFIER") stack.push(argTokens[0].value);
					else stack.push(this.evaluate(argTokens, { ...context, macroArgs: undefined }));
					break;
				}

				case "SYSVAR": {
					// Resolve system variables like .NAMESPACE / .NS and .PC
					const val = this.host.resolveSysValue(token) as SymbolValue;
					stack.push(val);
					break;
				}

				case "FUNCTION": {
					const resolver = (name: string) => {
						if (name === "*") return this.addressValue(context.PC.value);

						// 1. Macro Args (evaluated without the macro's own args, see resolveValue)
						if (context.macroArgs?.has(name)) {
							const tokens = context.macroArgs.get(name);
							if (tokens) return this.evaluate(tokens, { ...context, macroArgs: undefined });
						}

						// 2. Symbol Table (Identifier)
						let val = this.lookupVariable(name, token);
						if (Array.isArray(val) && val[0]?.type) return this.evaluate(val as Token[], context);
						if (val !== undefined) return val;

						// 3. Local Label
						if (context.currentLabel) {
							const qualified = `${context.currentLabel}.${name}`;
							val = this.symbolTable.lookupSymbol(qualified);
							if (val !== undefined) return val;
						}

						return context.allowForwardRef ? null : undefined;
					};
					this.functionDispatcher.dispatch(
						token.value.toUpperCase(),
						stack,
						token,
						this.symbolTable,
						token.argCount,
						resolver,
						context.allowForwardRef,
					);
					break;
				}

				case "USER_FUNCTION": {
					const argCount = token.argCount ?? 0;
					const args = stack.splice(stack.length - argCount, argCount);
					stack.push(this.callFunction(token, args, context));
					break;
				}

				case "PROPERTY_ACCESS": {
					const obj = stack.pop() as Record<string, SymbolValue>;
					// Pass 1: an object defined later isn't known yet, nor its field
					if (obj === null && context.allowForwardRef) {
						stack.push(null);
						break;
					}
					// Arrays too: the linker's SEGMENTS is meant to be both an array and a map (its skipped test, "Hybrid SEGMENTS Variable").
					if (obj instanceof RelocValue) {
						stack.push(obj.field(token.value));
						break;
					}
					if (typeof obj !== "object" || obj === null) throw new Error("Invalid property access on a non-object value.");

					const property = token.value;
					if (property && property in obj) {
						stack.push(obj[property] as SymbolValue);
						break;
					}

					throw new Error(`Property '${property}' does not exist on object.`);
				}

				case "OPERATOR": {
					const right = stack.pop();
					if (this.handleUnaryOperator(token as OperatorToken, right, stack)) break;
					if (this.handleArrayAccessOperator(token as OperatorToken, right, stack, context)) break;
					this.handleBinaryOperator(token as OperatorToken, right, stack);
					break;
				}
			}
		}

		if (stack.length !== 1) {
			// This can happen with expressions like "5 5" which is not a valid single expression.
			// It might also indicate an issue with string literals not being part of a valid expression.
			if (rpnTokens.length === 1 && (rpnTokens[0]?.type === "STRING" || rpnTokens[0]?.type === "IDENTIFIER")) return stack[0] as SymbolValue;

			throw new Error("Invalid expression format.");
		}

		return stack[0] as SymbolValue;
	}

	private handleUnaryOperator(token: OperatorToken, operand: SymbolValue | undefined | null, stack: (SymbolValue | null)[]): boolean {
		const right = charCode(operand);
		if (typeof right === "string" && UNARY_OPERATORS.has(token.value)) throw AsmError.at(notACharMessage(right), token);
		if (right instanceof RelocValue && UNARY_OPERATORS.has(token.value)) {
			const what = `'${UNARY_SYMBOLS[token.value]}'`;
			const shift = BYTE_SHIFTS[token.value];
			if (shift === undefined) throw AsmError.at(relocatableArgumentMessage(`Operator ${what}`, right), token);
			stack.push(relocatableByte(right, shift, what, token));
			return true;
		}
		switch (token.value) {
			case "UNARY_MINUS":
				if (right === null) {
					stack.push(right);
					return true;
				}
				if (typeof right !== "number") throw AsmError.at("Unary operator requires a numeric operand.", token);
				stack.push(-right);
				return true;
			case "!":
				if (right === null) {
					stack.push(right);
					return true;
				}
				if (typeof right !== "number") throw AsmError.at("Unary operator '!' requires a numeric operand.", token);
				stack.push(right === 0 ? 1 : 0);
				return true;
			case "UNARY_LSB":
				if (right === null) {
					stack.push(right);
					return true;
				}
				if (typeof right !== "number") throw AsmError.at("Unary operator '<' (LSB) requires a numeric operand.", token);
				stack.push(right & 0xff);
				return true;
			case "UNARY_MSB":
				if (right === null) {
					stack.push(right);
					return true;
				}
				if (typeof right !== "number") throw AsmError.at("Unary operator '>' (MSB) requires a numeric operand.", token);
				stack.push((right >> 8) & 0xff);
				return true;
			case "UNARY_BANK":
				if (right === null) {
					stack.push(right);
					return true;
				}
				if (typeof right !== "number") throw AsmError.at("Unary operator '^' (bank) requires a numeric operand.", token);
				stack.push((right >> 16) & 0xff);
				return true;
		}

		return false;
	}

	private handleArrayAccessOperator(
		token: OperatorToken,
		right: SymbolValue | undefined | null,
		stack: (SymbolValue | null)[],
		context: EvaluationContext,
	): boolean {
		if (token.value === "ARRAY_ACCESS") {
			const { allowForwardRef } = context;
			const arrIdx = right;
			const array = stack.pop() as SymbolValue[] | null;

			// Pass 1: an array or an index defined later isn't known yet, nor the element. What is known is still checked.
			if (allowForwardRef && (array === null || arrIdx === null)) {
				if (arrIdx !== null && typeof arrIdx !== "number") throw AsmError.at("Array index must be a number.", token);
				if (array !== null && !Array.isArray(array)) throw AsmError.at("Attempted to index a non-array value.", token);
				stack.push(null);
				return true;
			}

			if (typeof arrIdx !== "number") throw AsmError.at("Array index must be a number.", token);
			if (!Array.isArray(array)) throw AsmError.at("Attempted to index a non-array value.", token);

			if (arrIdx < 0 || arrIdx >= array.length) throw AsmError.at(`Array index ${arrIdx} out of bounds for array of length ${array.length}.`, token);

			// A macro's rest parameter holds each argument as its tokens: evaluated like a macro argument, without the macro's own.
			const element = array[arrIdx];
			stack.push(
				Array.isArray(element) && element[0]?.type ? this.evaluate(element as Token[], { ...context, macroArgs: undefined }) : (element as SymbolValue),
			);
			return true;
		}
		return false;
	}

	private handleBinaryOperator(token: OperatorToken, rightOperand: SymbolValue | undefined | null, stack: (SymbolValue | null)[]): void {
		let left = stack.pop();
		let right = rightOperand;
		if (left === undefined || right === undefined) throw AsmError.at(`Binary operator '${token.value}' requires two operands.`, token);

		// Two strings keep their text for + = == !=. Otherwise a one-char string is a number: "A"+1, $80|"H", "9"-"0".
		if (typeof left !== "string" || typeof right !== "string" || (!STRING_OPERATORS.has(token.value) && left.length === 1 && right.length === 1)) {
			left = charCode(left);
			right = charCode(right);
		}
		// A longer string next to a number: "AB"+1, 1+"AB"
		if (typeof left === "string" && typeof right === "number") throw AsmError.at(notACharMessage(left), token);
		if (typeof right === "string" && typeof left === "number") throw AsmError.at(notACharMessage(right), token);

		// Handle string operations first
		if (typeof left === "string") {
			// when pass 1 and forward ref: not known yet, as with a number
			if (right === null) {
				stack.push(null);
				return;
			}
			if (typeof right !== "string") throw AsmError.at(`Binary operator '${token.value}' requires two strings.`, token);

			switch (token.value) {
				case "+":
					stack.push(left + right);
					return;
				case "=":
				case "==":
					stack.push(left === right ? 1 : 0);
					return;
				case "!=":
					stack.push(left !== right ? 1 : 0);
					return;
				default:
					throw AsmError.at(`Operator '${token.value}' cannot be applied to strings.`, token);
			}
		}

		// when pass 1 and forward ref
		if (left === null || right === null) {
			stack.push(null);
			return;
		}
		if (left instanceof RelocValue || right instanceof RelocValue) {
			stack.push(this.relocatableOperation(token, left, right));
			return;
		}
		if (typeof left !== "number" || typeof right !== "number") throw AsmError.at(`Binary operator '${token.value}' requires two numbers.`, token);

		// Numeric operations
		switch (token.value) {
			case "=":
			case "==":
				stack.push(left === right ? 1 : 0);
				break;
			case "!=":
				stack.push(left !== right ? 1 : 0);
				break;
			case "<":
				stack.push(left < right ? 1 : 0);
				break;
			case ">":
				stack.push(left > right ? 1 : 0);
				break;
			case "<=":
				stack.push(left <= right ? 1 : 0);
				break;
			case ">=":
				stack.push(left >= right ? 1 : 0);
				break;
			case "+":
				stack.push(left + right);
				break;
			case "-":
				stack.push(left - right);
				break;
			case "*":
				stack.push(left * right);
				break;
			case "/":
				if (right === 0) throw AsmError.at("Division by zero.", token);
				// Not an integer division: 7 / 2 is 3.5 (see .floor, .ceil, .round).
				stack.push(left / right);
				break;
			// Bitwise results are 32-bit. With non-negative operands they're unsigned ($80000000 >> 4 is $08000000);
			// with a negative operand they stay signed, as two's complement (-8 >> 1 is -4).
			case "&":
				stack.push(left >= 0 && right >= 0 ? (left & right) >>> 0 : left & right);
				break;
			case "|":
				stack.push(left >= 0 && right >= 0 ? (left | right) >>> 0 : left | right);
				break;
			case "^":
				stack.push(left >= 0 && right >= 0 ? (left ^ right) >>> 0 : left ^ right);
				break;
			case "%":
				if (right === 0) throw AsmError.at("Modulo by zero.", token);
				stack.push(left % right);
				break;
			case "<<":
				stack.push(left >= 0 ? (left << right) >>> 0 : left << right);
				break;
			case ">>":
				stack.push(left >= 0 ? left >>> right : left >> right);
				break;
			case "&&":
				stack.push(left !== 0 && right !== 0 ? 1 : 0);
				break;
			case "||":
				stack.push(left !== 0 || right !== 0 ? 1 : 0);
				break;
			default:
				throw AsmError.at(`Unknown operator: ${token.value}`, token);
		}
	}

	/**
	 * `left` `token` `right`, one of them relocatable: `label + n`, `n + label` and `label - n` stay relocatable, the
	 * difference of two labels of the same segment is a number. Anything else has no value until the segment is loaded.
	 */
	private relocatableOperation(token: OperatorToken, left: SymbolValue, right: SymbolValue): SymbolValue {
		const isAddress = (value: SymbolValue): value is RelocValue => value instanceof RelocValue && value.byteShift === undefined;
		if (token.value === "+" && isAddress(left) && typeof right === "number") return new RelocValue(left.segment, left.offset + right);
		if (token.value === "+" && typeof left === "number" && isAddress(right)) return new RelocValue(right.segment, left + right.offset);
		if (token.value === "-" && isAddress(left) && typeof right === "number") return new RelocValue(left.segment, left.offset - right);
		if (token.value === "-" && isAddress(left) && isAddress(right)) {
			if (left.segment === right.segment) return left.offset - right.offset;
			throw AsmError.at(`${left} - ${right}: two relocatable segments are a distance apart only known when they're loaded.`, token);
		}
		const relocatable = (left instanceof RelocValue ? left : right) as RelocValue;
		throw AsmError.at(relocatableArgumentMessage(`Operator '${token.value}'`, relocatable), token);
	}

	/**
	 * Calls the user function `token` names with the values of its arguments: its parameters are variables of the call's
	 * scope, and its body is evaluated there, without the macro parameters of where it's called. An error in the body is
	 * located at the call, with a note at the function.
	 */
	private callFunction(token: ScalarToken, args: (SymbolValue | null)[], context: EvaluationContext): SymbolValue {
		const name = token.raw ?? token.value;
		// Defined at this point: pass 2 has the functions pass 1 defined further down, as `.def()` knows.
		const fn = this.symbolTable.isDefined(token.value) ? this.symbolTable.lookupSymbol(token.value) : undefined;
		if (fn === undefined) throw AsmError.at(`Unknown function '${name}'.`, token);
		if (!(fn instanceof UserFunction)) throw AsmError.at(`'${name}' isn't a function.`, token);

		const { parameters } = fn;
		if (args.length !== parameters.length)
			throw AsmError.at(
				`Function '${fn.name}' expects ${parameters.length} argument${parameters.length === 1 ? "" : "s"}, but got ${args.length}.`,
				token,
			);

		const depth = this.runningCalls.get(fn) ?? 0;
		const maxDepth = this.host.functionRecursion?.() ?? DEFAULT_OPTIONS["function.recursion"];
		if (depth > maxDepth)
			throw AsmError.at(
				maxDepth === 0
					? `Function '${fn.name}' calls itself, and .option function.recursion is 0.`
					: `Function '${fn.name}' calls itself more than ${maxDepth} deep (.option function.recursion).`,
				token,
			);

		this.runningCalls.set(fn, depth + 1);
		try {
			return this.symbolTable.withFunctionScope(fn.scopes, `function ${fn.name}`, () => {
				const { file = "", line = token.line, column = token.column } = fn.site.location;
				parameters.forEach((parameter, index) => {
					this.symbolTable.defineVariable(parameter.value, args[index] as SymbolValue, { filename: file, line, column });
				});
				if (!fn.isBlock) return this.evaluate([...fn.body], { ...context, macroArgs: undefined });
				if (!this.host.runFunction) throw AsmError.at(`Function '${fn.name}' can't be called here: its body has statements.`, token);
				return this.host.runFunction(fn);
			});
		} catch (e) {
			const error = e instanceof AsmError ? e : new AsmError(e instanceof Error ? e.message : String(e));
			if (!this.notedErrors.has(error)) {
				error.notes.push(this.functionNote(fn, error));
				this.notedErrors.add(error);
			}
			error.location = { line: token.line, column: token.column };
			throw error;
		} finally {
			if (depth === 0) this.runningCalls.delete(fn);
			else this.runningCalls.set(fn, depth);
		}
	}

	/**
	 * The note of an error in the body of `fn`: where it is in the body, else where `fn` is defined. A body line is
	 * numbered in its file, unless the function is defined in a macro body.
	 */
	private functionNote(fn: UserFunction, error: AsmError): AsmNote {
		const { line, column } = error.location;
		if (typeof line !== "number") return { message: `in function ${fn.name}, defined here`, ...fn.site };
		return { message: `in function ${fn.name}`, location: { file: fn.site.location.file, line, column }, includeStack: fn.site.includeStack };
	}

	/** A symbol's value: an error for a variable used before it's assigned, when it's assigned more than once. */
	private lookupVariable(name: string, position: { line: number | string; column: number }): SymbolValue | undefined {
		if (this.symbolTable.isAmbiguousForwardReference(name))
			throw AsmError.at(`Variable '${name}' is used before it's assigned, and it's assigned more than once: its value here is ambiguous.`, position);
		return this.symbolTable.lookupSymbol(name);
	}

	/** An address in the current segment: relocatable in a relocatable segment. */
	private addressValue(address: number): SymbolValue {
		return this.host.addressValue?.(address) ?? address;
	}

	private resolveValue(token: Token, context: EvaluationContext): SymbolValue | null {
		switch (token.type) {
			case "NUMBER":
				return Number.parseInt(token.value, 10);

			case "STRING":
				return token.value;

			case "IDENTIFIER":
			case "LABEL": {
				if (token.value === "*") return this.addressValue(context.PC.value);

				// PRIORITY 1: Check if it's a macro argument from the current stream context.
				const macroArgTokens = context.macroArgs?.get(token.value);
				if (macroArgTokens)
					// Evaluate the tokens passed as the argument. They come from the call site, so they
					// must not see the macro's own parameters: `m b, 2` with parameters `a, b` gives a = global b.
					return this.evaluate(macroArgTokens, { ...context, macroArgs: undefined });

				const value = this.lookupVariable(token.value, token);
				if (value instanceof UserFunction)
					throw AsmError.at(`'${token.raw ?? token.value}' is a function: call it, ${token.raw ?? token.value}(…).`, token);

				// If the symbol's value is an array of tokens, it's a macro parameter.
				// We need to evaluate it recursively. This handles .EQU with token arrays.
				if (Array.isArray(value) && value[0]?.type) return this.evaluate(value as Token[], context);

				if (value !== undefined) return value;

				if (context.allowForwardRef) return null; // Pass 1: Assume 0 for forward references.

				// If we are here, the symbol is not defined. Let's find suggestions.
				const suggestions = this.symbolTable.findSimilarSymbols(token.value);
				let errorMessage = `Undefined symbol '${token.value}'.`;
				if (suggestions.length > 0 && suggestions[0] !== token.value) errorMessage += ` Did you mean '${suggestions[0]}'?`;

				throw AsmError.at(errorMessage, token);
			}

			case "LOCAL_LABEL": {
				if (!context.currentLabel)
					throw AsmError.at(`Local label reference '${token.raw ?? token.value}' used without a preceding global label.`, token);

				const qualifiedName = `${context.currentLabel}.${token.value}`;
				const value = this.symbolTable.lookupSymbol(qualifiedName);
				if (value !== undefined) return value;

				if (context.allowForwardRef) return null; // Pass 1: Assume 0 for forward references.

				throw AsmError.at(`Undefined local label '${token.raw ?? token.value}' in scope '${context.currentLabel}'.`, token);
			}

			case "ANONYMOUS_LABEL_REF": {
				const distance = Number.parseInt(token.value, 10);
				const addr = this.host.findNearestLabel?.(context.PC.value, distance) ?? null;

				if (addr === null && !context.allowForwardRef)
					throw AsmError.at(`Not enough ${distance < 0 ? "preceding" : "succeeding"} anonymous labels to satisfy '${token.value}'.`, token);

				return addr === null ? null : this.addressValue(addr);
			}

			default:
				return 0;
		}
	}
}
