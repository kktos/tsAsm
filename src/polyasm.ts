import { EventEmitter } from "node:events";
import type { CPUHandler } from "./cpu/cpuhandler.class";
import { DirectiveHandler } from "./directives/handler";
import { MacroHandler } from "./directives/macro/handler";
import type { MacroDefinition } from "./directives/macro/macro.interface";
import { ExpressionEvaluator } from "./expression";
import { AssemblyLexer, type OperatorStackToken, type ScalarToken, type Token } from "./lexer/lexer.class";
import { Linker, type Segment } from "./linker.class";
import { Logger } from "./logger";
import { Parser } from "./parser.class";
import type { AssemblerOptions, DataProcessor, FileHandler, StreamState } from "./polyasm.types";
import { PASymbolTable } from "./symbol.class";
import { getHex } from "./utils/hex.util";

const DEFAULT_PC = 0x1000;

export class Assembler {
	public logger: Logger;
	public lexer: AssemblyLexer;
	public parser: Parser;
	public linker: Linker;
	private cpuHandler: CPUHandler;
	public fileHandler: FileHandler;

	public symbolTable: PASymbolTable;
	public currentPC: number;
	public isAssembling = true;
	public currentFilename = "";

	private lastGlobalLabel: string | null = null;
	public anonymousLabels: number[] = [];

	public macroDefinitions: Map<string, MacroDefinition> = new Map();
	private options: Map<string, string> = new Map();

	public pass: number;

	public expressionEvaluator: ExpressionEvaluator;
	public directiveHandler: DirectiveHandler;
	public macroHandler: MacroHandler;
	private rawDataProcessors?: Map<string, DataProcessor>;
	public emitter: EventEmitter;

	constructor(handler: CPUHandler, fileHandler: FileHandler, options?: AssemblerOptions) {
		this.cpuHandler = handler;
		this.fileHandler = fileHandler;
		this.logger = options?.logger ?? new Logger();
		this.linker = new Linker();
		this.rawDataProcessors = options?.rawDataProcessors;

		this.currentPC = DEFAULT_PC;
		this.symbolTable = new PASymbolTable();
		this.symbolTable.addSymbol("*", this.currentPC);

		this.expressionEvaluator = new ExpressionEvaluator(this, this.logger);
		this.directiveHandler = new DirectiveHandler(this, this.logger);
		this.macroHandler = new MacroHandler(this, this.logger);

		this.emitter = new EventEmitter();
		this.lexer = new AssemblyLexer(this.emitter);
		this.parser = new Parser(this.lexer, this.emitter);

		this.pass = -1;

		if (options?.segments) {
			for (const seg of options.segments) this.linker.addSegment(seg.name, seg.start, seg.size, seg.padValue, seg.resizable);
			if (options.segments[0]) this.linker.useSegment(options.segments[0].name);
		}
	}
	/** Convenience: add a segment via the embedded linker. */
	public addSegment(name: string, start: number, size: number, padValue = 0, resizable = false): void {
		this.linker.addSegment(name, start, size, padValue, resizable);
	}

	/** Convenience: link segments via the linker. */
	public link(segments?: Segment[]): number[] {
		return this.linker.link(segments);
	}

	/** Select the active segment for subsequent writes. */
	public useSegment(name: string): void {
		this.currentPC = this.linker.useSegment(name);
	}

	/** Write an array of bytes at the current PC via the linker and advance PC. */
	public writeBytes(bytes: number[]): void {
		this.linker.writeBytes(this.currentPC, bytes);
		this.currentPC += bytes.length;
	}

	public getDataProcessor(name: string) {
		return this.rawDataProcessors?.get(name);
	}

	public setOption(name: string, value: string) {
		this.options.set(name, value);
		const key = `option:${name}`;
		this.emitter.emit(key, value);
		this.logger.log(`setOption: ${key} = ${value}`);
	}

	public getOption(name: string) {
		return this.options.get(name);
	}

	public startNewStream(filename: string) {
		this.currentFilename = filename;
		const rawContent = this.fileHandler.readSourceFile(filename);
		this.lexer.startStream(rawContent);
	}

	public assemble(source: string): Segment[] {
		this.setOption("local_label_char", ":");

		// Initialize or re-initialize the lexer
		this.lexer.reset();
		this.parser.lexer = this.lexer;
		this.parser.start(source);

		this.passOne();

		// Ensure we start Pass 2 in the GLOBAL namespace (reset any .NAMESPACE from Pass 1)
		this.symbolTable.setNamespace("global");

		// this.currentPC = (this.symbolTable.lookupSymbol("*") as number) || 0x0000;
		// Ensure there's at least one segment: if none defined, create a default growable segment starting at 0
		if (!this.linker.segments || this.linker.segments.length === 0) {
			this.linker.addSegment("CODE", 0x1000, 0xf000);
			this.linker.useSegment("CODE");
		}

		// Reset stream stack for Pass 2 (fresh position)
		this.parser.restart();

		this.passTwo();

		this.logger.log(`\n--- Assembly Complete (${this.cpuHandler.cpuType}) ---`);
		this.logger.log(`Final PC location: $${getHex(this.currentPC)}`);

		// All emitted bytes are stored in the linker segments (a default segment was created if none existed).
		return this.linker.segments;
	}

	public getLastGlobalLabel(): string | null {
		return this.lastGlobalLabel;
	}

	private passOne(): void {
		this.logger.log(`\n--- Starting Pass 1: PASymbol Definition & PC Calculation (${this.cpuHandler.cpuType}) ---`);

		this.pass = 1;
		this.parser.setPosition(0);
		this.anonymousLabels = [];
		this.lastGlobalLabel = null;

		if (this.linker.segments.length) this.currentPC = this.linker.segments[0] ? this.linker.segments[0].start : DEFAULT_PC;

		while (this.parser.tokenStreamStack.length > 0) {
			const token = this.parser.nextToken();
			// If no token or EOF, pop the active stream
			if (!token || token.type === "EOF") {
				const poppedStream = this.parser.popTokenStream(false); // Don't emit event yet
				if (this.parser.tokenStreamStack.length === 0) break;
				if (poppedStream) this.emitter.emit(`endOfStream:${poppedStream.id}`);
				continue;
			}

			switch (token.type) {
				case "DOT": {
					const directiveToken = this.parser.nextToken() as ScalarToken;
					if (directiveToken?.type !== "IDENTIFIER") throw new Error(`Syntax error in line ${token.line}`);

					const directiveContext = {
						pc: this.currentPC,
						allowForwardRef: true,
						currentGlobalLabel: this.lastGlobalLabel,
						options: this.options,
						macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
					};

					this.directiveHandler.handlePassOneDirective(directiveToken, directiveContext);
					break;
				}

				case "OPERATOR": {
					if (token.value === "*") {
						this.lastGlobalLabel = "*";
						break;
					}

					if (token.value === "=" && this.lastGlobalLabel) {
						this.handleSymbolInPassOne(token, this.lastGlobalLabel);
						break;
					}
					throw new Error(`Syntax error in line ${token.line}`);
				}

				case "IDENTIFIER": {
					// PRIORITY 1: MACRO
					if (this.macroHandler.isMacro(token.value)) {
						this.macroHandler.expandMacro(token);
						break;
					}

					// PRIORITY 2: CPU INSTRUCTION ...

					// Check if the mnemonic is a known instruction for the current CPU.
					if (this.cpuHandler.isInstruction(token.value)) {
						this.handleInstructionPassOne(token as ScalarToken);
						break;
					}

					// PRIORITY 3: ... OR LABEL
					// It's not a known instruction, so treat it as a label definition.
					this.lastGlobalLabel = token.value;
					break;
				}
				case "LABEL": {
					this.lastGlobalLabel = token.value;
					this.symbolTable.addSymbol(token.value, this.currentPC);
					this.logger.log(`Defined label ${token.value} @ $${getHex(this.currentPC)}`);
					break;
				}

				case "LOCAL_LABEL": {
					if (!this.lastGlobalLabel) throw `ERROR on line ${token.line}: Local label ':${token.value}' defined without a preceding global label.`;

					const qualifiedName = `${this.lastGlobalLabel}.${token.value}`;
					this.symbolTable.addSymbol(qualifiedName, this.currentPC);
					break;
				}

				case "ANONYMOUS_LABEL_DEF": {
					this.anonymousLabels.push(this.currentPC);
					break;
				}
			}
		}
	}

	private passTwo(): void {
		this.logger.log(`\n--- Starting Pass 2: Code Generation (${this.cpuHandler.cpuType}) ---`);
		this.pass = 2;
		if (this.linker.segments.length) this.currentPC = this.linker.segments[0] ? this.linker.segments[0].start : DEFAULT_PC;

		this.anonymousLabels = [];
		this.lastGlobalLabel = null;

		while (this.parser.tokenStreamStack.length > 0) {
			const token = this.parser.nextToken();
			// If no token or EOF, pop the active stream
			if (!token || token.type === "EOF") {
				const poppedStream = this.parser.popTokenStream(false); // Don't emit event yet
				if (this.parser.tokenStreamStack.length === 0) break;
				if (poppedStream) this.emitter.emit(`endOfStream:${poppedStream.id}`);
				continue;
			}

			switch (token.type) {
				case "OPERATOR": {
					if (token.value === "*") {
						this.lastGlobalLabel = "*";
						break;
					}

					if (token.value === "=" && this.lastGlobalLabel) {
						this.handleSymbolInPassTwo(this.lastGlobalLabel, token);
						break;
					}
					throw new Error(`Syntax error in line ${token.line}`);
				}

				case "IDENTIFIER": {
					if (this.macroHandler.isMacro(token.value)) {
						this.macroHandler.expandMacro(token);
						break;
					}

					if (this.cpuHandler.isInstruction(token.value)) {
						this.handleInstructionPassTwo(token as OperatorStackToken);
						break;
					}

					this.lastGlobalLabel = token.value;
					break;
				}

				case "DOT": {
					const directiveToken = this.parser.nextToken() as ScalarToken;
					if (directiveToken?.type !== "IDENTIFIER") throw new Error(`Syntax error in line ${token.line}`);

					const streamBefore = this.parser.tokenStreamStack.length;
					const directiveContext = {
						pc: this.currentPC,
						macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
						currentGlobalLabel: this.lastGlobalLabel,
						options: this.options,
					};

					this.directiveHandler.handlePassTwoDirective(directiveToken, directiveContext);

					if (this.parser.tokenStreamStack.length > streamBefore) {
						// A new stream was pushed. The active context has changed, so we must start at its beginning.
						this.parser.setPosition(0);
						break;
					}
					break;
				}

				case "LABEL":
					this.lastGlobalLabel = token.value;
					this.symbolTable.setSymbol(token.value, this.currentPC);
					this.logger.log(`Defined label ${token.value} @ $${getHex(this.currentPC)}`);
					break;

				// case "LOCAL_LABEL":
				// 	this.currentTokenIndex++;
				// 	break;
				case "ANONYMOUS_LABEL_DEF":
					this.anonymousLabels.push(this.currentPC);
					break;
			}
		}
	}

	public handleSymbolInPassOne(_nextToken: Token, labelToken: string) {
		const expressionTokens = this.parser.getInstructionTokens();

		const value = this.expressionEvaluator.evaluate(expressionTokens, {
			pc: this.currentPC,
			allowForwardRef: true,
			currentGlobalLabel: this.lastGlobalLabel, // Added for .EQU
			macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
		});

		if (Array.isArray(value)) this.logger.log(`Defined array symbol ${labelToken} with ${value.length} elements.`);
		else this.logger.log(`Defined symbol ${labelToken} = $${value.toString(16).toUpperCase()}`);

		// if (this.symbolTable.lookupSymbol(labelToken) !== undefined) this.symbolTable.setSymbol(labelToken, value);
		if (this.symbolTable.isDefined(labelToken)) this.symbolTable.setSymbol(labelToken, value);
		else this.symbolTable.addSymbol(labelToken, value);
	}

	public handleSymbolInPassTwo(label: string, token: ScalarToken) {
		// Re-evaluate symbol assignment in Pass 2 so forward-references
		// that were unresolved in Pass 1 can be resolved now.

		const expressionTokens = this.parser.getExpressionTokens(token);

		const value = this.expressionEvaluator.evaluate(expressionTokens, {
			pc: this.currentPC,
			allowForwardRef: false, // now require resolution
			currentGlobalLabel: this.lastGlobalLabel,
			macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
			assembler: this,
		});

		// If evaluation produced undefined, treat as an error in Pass 2
		if (value === undefined) throw new Error(`Pass 2: Unresolved assignment for ${label} on line ${token.line}`);

		let logLine = `${label}`;
		switch (typeof value) {
			case "object":
				if (Array.isArray(value)) logLine += `= [${value.map((v) => v.value).join(",")}]`;
				else logLine += `= ${value}`;
				break;
			case "number":
				logLine += `= $${getHex(value)}`;
				break;
			case "string":
				logLine += `= "${value}"`;
				break;
		}
		this.logger.log(logLine);

		// If symbol exists already, update it; otherwise add it as a constant.
		if (this.symbolTable.lookupSymbol(label) !== undefined) this.symbolTable.setSymbol(label, value);
		else this.symbolTable.addSymbol(label, value);
	}

	private handleInstructionPassOne(mnemonicToken: ScalarToken): void {
		let operandTokens = this.parser.getInstructionTokens(mnemonicToken) as OperatorStackToken[];

		const currentStream = this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState;
		if (currentStream.macroArgs) operandTokens = this.substituteTokens(operandTokens, currentStream.macroArgs) as OperatorStackToken[];

		// It's an instruction. Resolve its size and advance the PC.
		try {
			const sizeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, (exprTokens) =>
				this.expressionEvaluator.evaluateAsNumber(exprTokens, {
					pc: this.currentPC,
					allowForwardRef: true,
					currentGlobalLabel: this.lastGlobalLabel,
					assembler: this,
				}),
			);
			this.currentPC += sizeInfo.bytes;
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			throw `ERROR on line ${mnemonicToken.line}: Could not determine size of instruction '${mnemonicToken.value}'. ${errorMessage}`;
		}
	}

	private handleInstructionPassTwo(mnemonicToken: OperatorStackToken): void {
		{
			const instructionPC = this.currentPC;
			// It's an instruction.
			let operandTokens = this.parser.getInstructionTokens(mnemonicToken) as OperatorStackToken[];

			const currentStream = this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState;
			if (currentStream.macroArgs) operandTokens = this.substituteTokens(operandTokens, currentStream.macroArgs) as OperatorStackToken[];

			if (this.isAssembling) {
				try {
					// 1. Resolve Mode & Address
					const modeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, (exprTokens) =>
						this.expressionEvaluator.evaluateAsNumber(exprTokens, {
							pc: this.currentPC,
							macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
							assembler: this,
							currentGlobalLabel: this.lastGlobalLabel,
						}),
					);

					// 2. Encode Bytes using resolved info
					const encodedBytes = this.cpuHandler.encodeInstruction([mnemonicToken, ...operandTokens], {
						...modeInfo,
						pc: this.currentPC,
					});

					// 3. LOGGING (New location)
					const hexBytes = encodedBytes.map((b) => getHex(b)).join(" ");
					const addressHex = instructionPC.toString(16).padStart(4, "0").toUpperCase();
					const operandString = operandTokens.map((t) => (t.type === "NUMBER" ? `$${getHex(Number(t.value))}` : t.value)).join("");
					this.logger.log(`${addressHex}: ${hexBytes.padEnd(8)} | ${mnemonicToken.value} ${operandString} ; Line ${mnemonicToken.line}`);

					this.linker.writeBytes(this.currentPC, encodedBytes);
					this.currentPC += encodedBytes.length;
				} catch (e) {
					const errorMessage = e instanceof Error ? e.message : String(e);
					throw new Error(`ERROR on line ${mnemonicToken.line}: Invalid instruction syntax or unresolved symbol. Error: ${errorMessage}`);
				}
			} else {
				// Not assembling: just advance PC
				this.currentPC += this.getInstructionSize();
			}
		}
	}

	public getInstructionSize(): number {
		try {
			const instructionTokens = this.parser.getInstructionTokens();
			const mnemonicToken = instructionTokens[0] as ScalarToken;
			const operandTokens = instructionTokens.slice(1) as OperatorStackToken[];

			const sizeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, (exprTokens) =>
				this.expressionEvaluator.evaluateAsNumber(exprTokens, {
					pc: this.currentPC,
					macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
					currentGlobalLabel: this.lastGlobalLabel, // Added for instruction size evaluation
				}),
			);
			return sizeInfo.bytes;
		} catch (_e) {
			return this.cpuHandler.cpuType === "ARM_RISC" ? 4 : 3; // Robust default based on CPU type
		}
	}

	private substituteTokens(tokens: Token[], macroArgs: Map<string, Token[]>): Token[] {
		const result: Token[] = [];
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i] as Token;

			if (token.type !== "IDENTIFIER" || !macroArgs.has(token.value)) {
				result.push(token);
				continue;
			}

			// Token is a macro argument.

			// Check for array access like `parms[0]`
			if (i + 1 < tokens.length && tokens[i + 1]?.value === "[") {
				let j = i + 2;
				let parenDepth = 0;
				const indexTokens: Token[] = [];

				// Find closing ']' and gather index tokens
				while (j < tokens.length) {
					if (tokens[j]?.value === "[") parenDepth++;
					else if (tokens[j]?.value === "]") {
						if (parenDepth === 0) break;
						parenDepth--;
					}
					indexTokens.push(tokens[j] as Token);
					j++;
				}

				// If we found a complete `[...]` expression
				if (j < tokens.length && tokens[j]?.value === "]") {
					const indexValue = this.expressionEvaluator.evaluateAsNumber(indexTokens, {
						pc: this.currentPC,
						macroArgs: macroArgs, // Pass current macro args for evaluation context
						assembler: this,
						currentGlobalLabel: this.lastGlobalLabel,
					});

					// const argTokens = macroArgs.get(token.value) ?? [];
					// const expressions = this.extractExpressionArrayTokens(argTokens);
					const argTokens = macroArgs.get(token.value) ?? [];

					// if(expressions[0].type==="ARRAY") expressions = expressions[0].value;
					const expressions = argTokens[0]?.value as Token[][];

					if (indexValue < 0 || indexValue >= expressions.length)
						throw new Error(`Macro argument index ${indexValue} out of bounds for argument '${token.value}' on line ${token.line}.`);

					// result.push(...expressions[indexValue]);
					result.push(...(expressions[indexValue] as Token[]));
					i = j; // Advance main loop past `]`
					continue;
				}
			}

			// If not array access, it's a simple substitution
			result.push(...(macroArgs.get(token.value) ?? []));
		}
		return result;
	}
}
