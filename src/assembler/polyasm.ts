import { EventEmitter } from "node:events";
import type { CPUHandler } from "../cpu/cpuhandler.class";
import type { DirectiveContext } from "../directives/directive.interface";
import { DirectiveHandler } from "../directives/handler";
import { MacroHandler } from "../directives/macro/handler";
import type { MacroDefinition } from "../directives/macro/macro.interface";
import { Lister } from "../helpers/lister.class";
import { Logger } from "../helpers/logger.class";
import { Linker, type Segment } from "../linker/linker.class";
import type { OperatorStackToken, ScalarToken, Token } from "../shared/lexer/lexer.class";
import { getHex } from "../utils/hex.util";
import { ExpressionEvaluator } from "./expression";
import { NamelessLabels } from "./namelesslabels.class";
import { Parser } from "./parser.class";
import type { AssemblerOptions, DataProcessor, FileHandler, StreamState } from "./polyasm.types";
import { PASymbolTable } from "./symbol.class";

const DEFAULT_PC = 0x1000;

export class Assembler {
	public logger: Logger;
	public lister: Lister;
	// public lexer: AssemblyLexer;
	public parser: Parser;
	public linker: Linker;
	private cpuHandler: CPUHandler;
	public fileHandler: FileHandler;

	public symbolTable: PASymbolTable;
	public currentPC = 0;
	public isAssembling = true;

	public currentFilename = "";
	private filenameStack: string[] = [];

	public lastGlobalLabel: string | null = null;
	// public anonymousLabels: number[] = [];
	public namelessLabels: NamelessLabels = new NamelessLabels();

	public macroDefinitions: Map<string, MacroDefinition> = new Map();
	private options: Map<string, string> = new Map();

	public pass: number;

	public expressionEvaluator: ExpressionEvaluator;
	public directiveHandler: DirectiveHandler;
	public macroHandler: MacroHandler;
	private rawDataProcessors?: Map<string, DataProcessor>;
	private defaultRawDataProcessor = "";
	public emitter: EventEmitter;

	constructor(handler: CPUHandler, fileHandler: FileHandler, options?: AssemblerOptions) {
		this.cpuHandler = handler;
		this.fileHandler = fileHandler;
		this.logger = options?.logger ?? new Logger();
		this.lister = new Lister(this.logger);
		this.linker = new Linker(this.logger);

		if (options?.rawDataProcessors) {
			this.rawDataProcessors = options.rawDataProcessors.map;
			this.defaultRawDataProcessor = options.rawDataProcessors.default || "";
			if (!this.rawDataProcessors.has(this.defaultRawDataProcessor)) throw "Default data processor not found.";
		}

		// this.currentPC = DEFAULT_PC;
		this.symbolTable = new PASymbolTable();
		// this.symbolTable.assignVariable("*", this.currentPC);

		this.expressionEvaluator = new ExpressionEvaluator(this, this.logger);
		this.directiveHandler = new DirectiveHandler(this, this.logger, this.lister);
		this.macroHandler = new MacroHandler(this);

		this.emitter = new EventEmitter();
		// this.lexer = new AssemblyLexer(this.emitter);
		this.parser = new Parser(this.emitter);

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
		return this.linker.rawBinaryLink(segments);
	}

	/** Select the active segment for subsequent writes. */
	public useSegment(name: string) {
		this.currentPC = this.linker.useSegment(name);
	}

	/** Write an array of bytes at the current PC via the linker and advance PC. */
	public writeBytes(bytes: number[]) {
		this.linker.writeBytes(this.currentPC, bytes);
		this.currentPC += bytes.length;
	}

	public getDataProcessor(name?: string) {
		return this.rawDataProcessors?.get(name ?? this.defaultRawDataProcessor);
	}

	public setOption(name: string, value: string) {
		this.options.set(name, value);
		const key = `option:${name}`;
		this.emitter.emit(key, value);
		this.lister.directive("option", `${name} = "${value}"`);
	}

	public getOption(name: string) {
		return this.options.get(name);
	}

	public startNewStream(filename: string) {
		this.filenameStack.push(this.currentFilename);
		const rawContent = this.fileHandler.readSourceFile(filename, this.currentFilename);
		this.currentFilename = this.fileHandler.fullpath;
		if (this.pass === 1) this.parser.lexer.startStream(rawContent);
	}

	public endCurrentStream() {
		this.currentFilename = this.filenameStack.pop() ?? "";
	}

	public setCPUHandler(handler: CPUHandler) {
		this.cpuHandler = handler;
	}

	public getCPUHandler(): CPUHandler {
		return this.cpuHandler;
	}

	public assemble(source: string): Segment[] {
		this.setOption("local_label_char", ":");

		// Initialize or re-initialize the lexer
		this.parser.start(source);

		try {
			this.passOne();

			// Ensure there's at least one segment: if none defined, create a default growable segment starting at 0
			if (!this.linker.segments || this.linker.segments.length === 0) {
				this.linker.addSegment("CODE", DEFAULT_PC, 0, 0, true);
				this.linker.useSegment("CODE");
			}

			// Reset stream stack for Pass 2 (fresh position)
			this.parser.restart();

			this.passTwo();
		} catch (e) {
			throw `${e} - pass ${this.pass} - file ${this.currentFilename}`;
		}

		this.logger.log("\n--- Assembly Complete ---");

		return this.linker.segments;
	}

	private passOne(): void {
		this.logger.log("\n--- Starting Pass 1: PASymbol Definition & PC Calculation ---");

		this.symbolTable.setNamespace("global");

		this.pass = 1;
		this.namelessLabels.clear();
		this.lastGlobalLabel = null;

		let blockDepth = 0;

		if (this.linker.segments.length) this.currentPC = this.linker.segments[0] ? this.linker.segments[0].start : DEFAULT_PC;

		while (this.parser.tokenStreamStack.length > 0) {
			const token = this.parser.next();
			// If no token or EOF, pop the active stream
			if (!token || token.type === "EOF") {
				const poppedStream = this.parser.popTokenStream(false); // Don't emit event yet
				if (this.parser.tokenStreamStack.length === 0) break;
				if (poppedStream) this.emitter.emit(`endOfStream:${poppedStream.id}`);
				continue;
			}

			switch (token.type) {
				case "DOT": {
					const directiveToken = this.parser.next() as ScalarToken;
					if (directiveToken?.type !== "IDENTIFIER") throw new Error(`Bad directive in line ${token.line} - ${directiveToken.value}`);

					const directiveContext: DirectiveContext = {
						pc: this.currentPC,
						allowForwardRef: true,
						currentGlobalLabel: this.lastGlobalLabel,
						// options: this.options,
						macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
						writebytes: this.writeBytes.bind(this),
					};

					if (!this.directiveHandler.handlePassOneDirective(directiveToken, directiveContext))
						throw new Error(`Syntax error in line ${token.line} - Unexpected directive '${directiveToken.value}'`);
					break;
				}

				case "OPERATOR": {
					if (token.value === "*") {
						this.lastGlobalLabel = "*";
						break;
					}

					if (token.value === "=" && this.lastGlobalLabel) {
						const directiveContext: DirectiveContext = {
							pc: this.currentPC,
							allowForwardRef: true,
							currentGlobalLabel: this.lastGlobalLabel,
							// options: this.options,
							macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
							writebytes: this.writeBytes.bind(this),
						};
						if (!this.directiveHandler.handlePassOneDirective(token, directiveContext))
							throw new Error(`Syntax error in line ${token.line} - Unexpected directive '${token.value}'`);
						break;
					}

					throw new Error(`Syntax error in line ${token.line} - Unexpected operator '${token.value}'`);
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
					if (!this.parser.isOperator("=") && !this.parser.isDirective("EQU")) {
						this.symbolTable.defineConstant(token.value, this.currentPC);
						this.lister.label(token.raw ?? token.value, this.currentPC);
					}
					break;
				}
				case "LABEL": {
					this.lastGlobalLabel = token.value;
					this.symbolTable.defineConstant(token.value, this.currentPC);
					this.lister.label(token.raw ?? token.value, this.currentPC);
					break;
				}

				case "LOCAL_LABEL": {
					if (!this.lastGlobalLabel) throw `ERROR on line ${token.line}: Local label ':${token.value}' defined without a preceding global label.`;

					const qualifiedName = `${this.lastGlobalLabel}.${token.value}`;
					this.symbolTable.defineConstant(qualifiedName, this.currentPC);
					break;
				}

				case "ANONYMOUS_LABEL_DEF": {
					this.namelessLabels.add({ address: this.currentPC, ...token, file: this.currentFilename });
					break;
				}

				case "LBRACE":
					blockDepth++;
					break;
				case "RBRACE":
					blockDepth--;
					break;

				default:
					throw new Error(`Syntax error in line ${token.line} : ${token.type} ${token.value}`);
			}
		}
		if (blockDepth !== 0) throw new Error(`Syntax error : Unbalanced braces. Depth: ${blockDepth}`);
	}

	private passTwo(): void {
		this.logger.log("\n--- Starting Pass 2: Code Generation ---");
		this.pass = 2;
		if (this.linker.segments.length) this.currentPC = this.linker.segments[0] ? this.linker.segments[0].start : DEFAULT_PC;

		this.symbolTable.setNamespace("global");

		this.lastGlobalLabel = null;

		while (this.parser.tokenStreamStack.length > 0) {
			const token = this.parser.next();
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
						const directiveContext: DirectiveContext = {
							pc: this.currentPC,
							macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
							currentGlobalLabel: this.lastGlobalLabel,
							// options: this.options,
							writebytes: this.writeBytes.bind(this),
						};

						this.directiveHandler.handlePassTwoDirective(token, directiveContext);
						break;
					}

					throw new Error(`Syntax error in line ${token.line} - Unexpected operator '${token.value}'`);
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
					if (!this.parser.isOperator("=") && !this.parser.isDirective("EQU")) {
						// In functions, the scope is lost between the passes
						if (this.symbolTable.hasSymbolInScope(token.value)) this.symbolTable.updateSymbol(token.value, this.currentPC);
						else this.symbolTable.defineConstant(token.value, this.currentPC);
						this.lister.label(token.raw ?? token.value, this.currentPC);
					}
					break;
				}

				case "DOT": {
					const directiveToken = this.parser.next() as ScalarToken;
					if (directiveToken?.type !== "IDENTIFIER") throw new Error(`Syntax error in line ${token.line}`);

					const streamBefore = this.parser.tokenStreamStack.length;
					const directiveContext: DirectiveContext = {
						pc: this.currentPC,
						macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
						currentGlobalLabel: this.lastGlobalLabel,
						// options: this.options,
						writebytes: this.writeBytes.bind(this),
					};

					this.directiveHandler.handlePassTwoDirective(directiveToken, directiveContext);

					if (this.parser.tokenStreamStack.length > streamBefore) {
						// A new stream was pushed. The active context has changed, so we must start at its beginning.
						this.parser.setPosition(0);
						break;
					}
					break;
				}

				case "LABEL": {
					this.lastGlobalLabel = token.value;
					// TODO : this is not true anymore
					// In functions, the scope is lost between the passes
					if (this.symbolTable.hasSymbolInScope(token.value)) this.symbolTable.updateSymbol(token.value, this.currentPC);
					else this.symbolTable.defineConstant(token.value, this.currentPC);

					this.lister.label(token.raw ?? token.value, this.currentPC);

					break;
				}

				case "ANONYMOUS_LABEL_DEF":
					this.namelessLabels.add({ address: this.currentPC, ...token, file: this.currentFilename });

					break;
			}
		}
	}

	private handleInstructionPassOne(mnemonicToken: ScalarToken): void {
		let operandTokens = this.parser.getInstructionTokens(mnemonicToken) as OperatorStackToken[];

		const currentStream = this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState;
		if (currentStream.macroArgs) operandTokens = this.substituteTokens(operandTokens, currentStream.macroArgs) as OperatorStackToken[];

		const instructionPC = this.currentPC;

		// It's an instruction. Resolve its size and advance the PC.
		try {
			const sizeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, (exprTokens, numberMax = 0) =>
				this.expressionEvaluator.evaluateAsNumber(exprTokens, {
					pc: this.currentPC,
					allowForwardRef: true,
					currentGlobalLabel: this.lastGlobalLabel,
					assembler: this,
					numberMax,
				}),
			);
			this.currentPC += sizeInfo.bytes;

			const operandString = operandTokens.map((t) => (t.type === "NUMBER" ? `$${getHex(Number(t.value))}` : t.value)).join("");
			this.lister.bytes({
				addr: instructionPC,
				bytes: Array.from({ length: sizeInfo.bytes }, () => 0),
				text: `${mnemonicToken.value} ${operandString}`,
			});
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			throw `line ${mnemonicToken.line}: Could not determine size of instruction '${mnemonicToken.value}'.\n${JSON.stringify(operandTokens)}\n${errorMessage}`;
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
					const modeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, (exprTokens, numberMax = 0) =>
						this.expressionEvaluator.evaluateAsNumber(exprTokens, {
							pc: this.currentPC,
							macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
							assembler: this,
							currentGlobalLabel: this.lastGlobalLabel,
							numberMax,
						}),
					);

					// 2. Encode Bytes using resolved info
					const encodedBytes = this.cpuHandler.encodeInstruction([mnemonicToken, ...operandTokens], {
						...modeInfo,
						pc: this.currentPC,
					});

					// 3. LOGGING (New location)
					const operandString = operandTokens.map((t) => (t.type === "NUMBER" ? `$${getHex(Number(t.value))}` : t.value)).join("");
					this.lister.bytes({
						addr: instructionPC,
						bytes: encodedBytes,
						text: `${mnemonicToken.value} ${operandString}`,
					});

					// const hexBytes = encodedBytes.map((b) => getHex(b)).join(" ");
					// const addressHex = instructionPC.toString(16).padStart(4, "0").toUpperCase();
					// const operandString = operandTokens.map((t) => (t.type === "NUMBER" ? `$${getHex(Number(t.value))}` : t.value)).join("");
					// this.logger.log(`${addressHex}: ${hexBytes.padEnd(8)} | ${mnemonicToken.value} ${operandString} ; Line ${mnemonicToken.line}`);

					this.linker.writeBytes(this.currentPC, encodedBytes);
					this.currentPC += encodedBytes.length;
				} catch (e) {
					const errorMessage = e instanceof Error ? e.message : String(e);
					throw new Error(`line ${mnemonicToken.line}: Invalid instruction syntax or unresolved symbol. Error: ${errorMessage}`);
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
						throw new Error(`line ${token.line}: Macro argument index ${indexValue} out of bounds for argument '${token.value}'.`);

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
