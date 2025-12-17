import { EventEmitter } from "node:events";
import type { CPUHandler } from "../cpu/cpuhandler.interface";
import type { DirectiveContext, DirectiveRuntime } from "../directives/directive.interface";
import { DirectiveHandler } from "../directives/handler";
import { MacroHandler } from "../directives/macro/handler";
import type { MacroDefinition } from "../directives/macro/macro.interface";
import { ConsoleSink } from "../helpers/consolesink.class";
import { Lister } from "../helpers/lister.class";
import { Logger } from "../helpers/logger.class";
import { Linker, type Segment } from "../linker/linker.class";
import type { OperatorStackToken, ScalarToken, Token } from "../shared/lexer/lexer.class";
import { formatLogPrefix } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";
import { ExpressionEvaluator } from "./expression";
import type { ValueHolder } from "./expression.types";
import { NamelessLabels } from "./namelesslabels.class";
import { Parser, ParserError } from "./parser.class";
import type { AssemblerOptions, DataProcessor, FileHandler, StreamState } from "./polyasm.types";
import { PASymbolTable } from "./symbol.class";

const DEFAULT_PC = 0x1000;

export class Assembler {
	public logger: Logger;
	public lister: Lister;
	public parser: Parser;
	public linker: Linker;
	private cpuHandler: CPUHandler;
	public fileHandler: FileHandler;

	public symbolTable: PASymbolTable;
	private isAssembling = true;
	private PC: ValueHolder = { value: 0 };

	public currentFilepath = "";
	public currentFilename = "";
	private filenameStack: { path: string; name: string }[] = [];

	public lastGlobalLabel: string | null = null;
	private lastGlobalLabelLine: string | number = 0;
	public namelessLabels: NamelessLabels = new NamelessLabels();

	public macroDefinitions: Map<string, MacroDefinition> = new Map();
	private options: Map<string, string> = new Map();

	public pass: number;

	private wannaLogPass1 = false;
	private wannaLogPass2 = false;

	public expressionEvaluator: ExpressionEvaluator;
	public directiveHandler: DirectiveHandler;
	public macroHandler: MacroHandler;
	private rawDataProcessors?: Map<string, DataProcessor>;
	private defaultRawDataProcessor = "";
	public emitter: EventEmitter;

	constructor(handler: CPUHandler, fileHandler: FileHandler, options?: AssemblerOptions) {
		this.cpuHandler = handler;
		this.fileHandler = fileHandler;
		this.logger =
			options?.logger ??
			new Logger({
				sink: new ConsoleSink(),
				enabled: true,
				cached: false,
			});
		this.lister = new Lister(this.logger);

		this.linker = new Linker();
		this.PC = this.linker.PC;
		this.PC.value = DEFAULT_PC;

		if (options?.rawDataProcessors) {
			this.rawDataProcessors = options.rawDataProcessors.map;
			this.defaultRawDataProcessor = options.rawDataProcessors.default || "";
			if (!this.rawDataProcessors.has(this.defaultRawDataProcessor)) throw "Default data processor not found.";
		}

		this.symbolTable = new PASymbolTable(this.lister);

		const resolveSysValue = (nameToken: Token) => this.resolveSysValue(nameToken);
		this.expressionEvaluator = new ExpressionEvaluator(this.symbolTable, this.namelessLabels.findNearest.bind(this.namelessLabels), resolveSysValue);

		this.macroHandler = new MacroHandler(this);

		this.emitter = new EventEmitter();
		this.parser = new Parser(this.emitter);

		const runtime: DirectiveRuntime = {
			parser: this.parser,
			symbolTable: this.symbolTable,
			evaluator: this.expressionEvaluator,
			lister: this.lister,
			logger: this.logger,
			linker: this.linker,
		};
		this.directiveHandler = new DirectiveHandler(this, runtime);

		this.pass = -1;

		if (options?.segments) {
			for (const seg of options.segments) this.linker.addSegment(seg.name, seg.start, seg.size, seg.padValue, seg.resizable);
			if (options.segments[0]) this.linker.useSegment(options.segments[0].name);
		}

		if (options?.log?.pass1Enabled) this.wannaLogPass1 = true;
		if (options?.log?.pass2Enabled) this.wannaLogPass2 = true;
	}

	private resolveSysValue(nameToken: Token) {
		switch (nameToken.value) {
			case "NAMESPACE":
			case "NS":
				return this.symbolTable.getCurrentNamespace();

			case "PC":
				return this.PC.value;

			case "PASS":
				return this.pass;

			case "SEGMENT":
				return this.linker.currentSegment;

			case "FILENAME":
				return this.currentFilename;

			case "FILEPATH":
				return this.currentFilepath;

			default:
				throw new Error(`Unknown system variable: ${nameToken.value} on line ${nameToken.line}.`);
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
		this.PC.value = this.linker.useSegment(name);
	}

	/** Write an array of bytes at the current PC via the linker and advance PC. */
	private writeBytes(bytes: number[]) {
		this.linker.writeBytes(this.PC.value, bytes);
		this.PC.value += bytes.length;
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
		this.filenameStack.push({ path: this.currentFilepath, name: this.currentFilename });
		const rawContent = this.fileHandler.readSourceFile(filename, this.currentFilepath);
		this.currentFilepath = this.fileHandler.fullpath;
		this.currentFilename = this.fileHandler.filename;
		if (this.pass === 1) this.parser.lexer.startStream(rawContent);
	}

	public endCurrentStream() {
		const file = this.filenameStack.pop();
		if (file) {
			this.currentFilepath = file.path;
			this.currentFilename = file.name;
		}
	}

	public setCPUHandler(handler: CPUHandler) {
		this.cpuHandler = handler;
	}

	public getCPUHandler(): CPUHandler {
		return this.cpuHandler;
	}

	public assemble(source: string): Segment[] {
		const isLogEnabled = this.logger.enabled;
		this.logger.enabled = isLogEnabled && this.wannaLogPass1;

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
			this.logger.enabled = isLogEnabled && this.wannaLogPass2;

			this.passTwo();

			this.logger.enabled = isLogEnabled;
		} catch (e) {
			if (e instanceof ParserError)
				throw `${formatLogPrefix({ column: e.token?.column ?? 0, line: e.token?.line ?? 0 }, { filename: this.currentFilepath })}${e} - pass ${this.pass}`;

			throw `${formatLogPrefix({ column: 0, line: "" }, { filename: this.currentFilepath })}${e} - pass ${this.pass}`;
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

		if (this.linker.segments.length) this.PC.value = this.linker.segments[0] ? this.linker.segments[0].start : DEFAULT_PC;

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
						filename: this.currentFilepath,
						isAssembling: this.isAssembling,
						PC: this.PC,
						allowForwardRef: true,
						currentLabel: this.lastGlobalLabel,
						macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
						emitbytes: this.writeBytes.bind(this),
						readBinaryFile: this.fileHandler.readBinaryFile.bind(this.fileHandler),
						readSourceFile: this.fileHandler.readSourceFile.bind(this.fileHandler),
					};

					if (!this.directiveHandler.handlePassOneDirective(directiveToken, directiveContext))
						throw new ParserError(`Syntax error - Unexpected directive '${directiveToken.value}'`, directiveToken);
					break;
				}

				case "OPERATOR": {
					if (token.value === "*") {
						this.lastGlobalLabel = "*";
						break;
					}

					if (token.value === "=" && this.lastGlobalLabel) {
						const directiveContext: DirectiveContext = {
							filename: this.currentFilepath,
							isAssembling: this.isAssembling,
							PC: this.PC,
							allowForwardRef: true,
							currentLabel: this.lastGlobalLabel,
							macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
							emitbytes: this.writeBytes.bind(this),
							readBinaryFile: this.fileHandler.readBinaryFile.bind(this.fileHandler),
							readSourceFile: this.fileHandler.readSourceFile.bind(this.fileHandler),
						};
						if (!this.directiveHandler.handlePassOneDirective(token, directiveContext))
							throw new ParserError(`Syntax error - Unexpected directive '${token.value}'`, token);
						break;
					}

					throw new ParserError(`Syntax error - Unexpected operator '${token.value}'`, token);
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
					if (this.lastGlobalLabel && this.lastGlobalLabelLine === token.line)
						throw new ParserError(`Syntax error - (Unknown opcode?) Unexpected label '${token.value}' after ${this.lastGlobalLabel}`, token);

					this.lastGlobalLabel = token.value;
					this.lastGlobalLabelLine = token.line;
					if (!this.parser.isOperator("=") && !this.parser.isDirective("EQU")) {
						this.symbolTable.defineConstant(token.value, this.PC.value);
						this.lister.label(token.raw ?? token.value, this.PC.value);
					}
					break;
				}
				case "LABEL": {
					this.lastGlobalLabel = token.value;
					this.symbolTable.defineConstant(token.value, this.PC.value);
					this.lister.label(token.raw ?? token.value, this.PC.value);
					break;
				}

				case "LOCAL_LABEL": {
					if (!this.lastGlobalLabel) throw new ParserError(`ERROR: Local label ':${token.value}' defined without a preceding global label.`, token);

					const qualifiedName = `${this.lastGlobalLabel}.${token.value}`;
					this.symbolTable.defineConstant(qualifiedName, this.PC.value);
					break;
				}

				case "ANONYMOUS_LABEL_DEF": {
					this.namelessLabels.add({ address: this.PC.value, ...token, file: this.currentFilepath });
					break;
				}

				case "LBRACE":
					blockDepth++;
					break;
				case "RBRACE":
					blockDepth--;
					break;

				default:
					throw new ParserError(`Syntax error : ${token.type} ${token.value}`, token);
			}
		}
		if (blockDepth !== 0) throw new ParserError(`Syntax error : Unbalanced braces. Depth: ${blockDepth}`);
	}

	private passTwo(): void {
		this.logger.log("\n--- Starting Pass 2: Code Generation ---");
		this.pass = 2;
		if (this.linker.segments.length) this.PC.value = this.linker.segments[0] ? this.linker.segments[0].start : DEFAULT_PC;

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
							filename: this.currentFilepath,
							isAssembling: this.isAssembling,
							PC: this.PC,
							macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
							currentLabel: this.lastGlobalLabel,
							emitbytes: this.writeBytes.bind(this),
							readBinaryFile: this.fileHandler.readBinaryFile.bind(this.fileHandler),
							readSourceFile: this.fileHandler.readSourceFile.bind(this.fileHandler),
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
						if (this.symbolTable.hasSymbolInScope(token.value)) this.symbolTable.updateSymbol(token.value, this.PC.value);
						else this.symbolTable.defineConstant(token.value, this.PC.value);
						this.lister.label(token.raw ?? token.value, this.PC.value);
					}
					break;
				}

				case "DOT": {
					const directiveToken = this.parser.next() as ScalarToken;
					if (directiveToken?.type !== "IDENTIFIER") throw new Error(`Syntax error in line ${token.line}`);

					const streamBefore = this.parser.tokenStreamStack.length;
					const directiveContext: DirectiveContext = {
						filename: this.currentFilepath,
						isAssembling: this.isAssembling,
						PC: this.PC,
						macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
						currentLabel: this.lastGlobalLabel,
						emitbytes: this.writeBytes.bind(this),
						readBinaryFile: this.fileHandler.readBinaryFile.bind(this.fileHandler),
						readSourceFile: this.fileHandler.readSourceFile.bind(this.fileHandler),
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
					if (this.symbolTable.hasSymbolInScope(token.value)) this.symbolTable.updateSymbol(token.value, this.PC.value);
					else this.symbolTable.defineConstant(token.value, this.PC.value);

					this.lister.label(token.raw ?? token.value, this.PC.value);

					break;
				}

				case "ANONYMOUS_LABEL_DEF":
					this.namelessLabels.add({ address: this.PC.value, ...token, file: this.currentFilepath });

					break;
			}
		}
	}

	private handleInstructionPassOne(mnemonicToken: ScalarToken): void {
		let operandTokens = this.parser.getInstructionTokens(mnemonicToken) as OperatorStackToken[];

		const currentStream = this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState;
		if (currentStream.macroArgs) operandTokens = this.substituteTokens(operandTokens, currentStream.macroArgs) as OperatorStackToken[];

		const instructionPC = this.PC.value;

		// It's an instruction. Resolve its size and advance the PC.
		try {
			const sizeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, (exprTokens, numberMax = 0) =>
				this.expressionEvaluator.evaluateAsNumber(exprTokens, {
					PC: this.PC,
					allowForwardRef: true,
					currentLabel: this.lastGlobalLabel,
					numberMax,
				}),
			);
			this.PC.value += sizeInfo.bytes;

			const operandString = operandTokens.map((t) => (t.type === "NUMBER" ? `$${getHex(Number(t.value))}` : t.value)).join("");
			this.lister.bytes({
				addr: instructionPC,
				bytes: Array.from({ length: sizeInfo.bytes }, () => 0),
				text: `${mnemonicToken.value} ${operandString}`,
			});
		} catch (e) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			throw `line ${mnemonicToken.line}: Could not determine size of instruction '${mnemonicToken.value}'.${errorMessage}`;
		}
	}

	private handleInstructionPassTwo(mnemonicToken: OperatorStackToken): void {
		{
			const instructionPC = this.PC.value;
			// It's an instruction.
			let operandTokens = this.parser.getInstructionTokens(mnemonicToken) as OperatorStackToken[];

			const currentStream = this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState;
			if (currentStream.macroArgs) operandTokens = this.substituteTokens(operandTokens, currentStream.macroArgs) as OperatorStackToken[];

			if (this.isAssembling) {
				try {
					// 1. Resolve Mode & Address
					const modeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, (exprTokens, numberMax = 0) =>
						this.expressionEvaluator.evaluateAsNumber(exprTokens, {
							PC: this.PC,
							macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
							currentLabel: this.lastGlobalLabel,
							numberMax,
						}),
					);

					// 2. Encode Bytes using resolved info
					const encodedBytes = this.cpuHandler.encodeInstruction([mnemonicToken, ...operandTokens], {
						...modeInfo,
						pc: this.PC.value,
					});

					// 3. LOGGING (New location)
					const operandString = operandTokens.map((t) => (t.type === "NUMBER" ? `$${getHex(Number(t.value))}` : t.value)).join("");
					this.lister.bytes({
						addr: instructionPC,
						bytes: encodedBytes,
						text: `${mnemonicToken.value} ${operandString}`,
					});

					this.linker.writeBytes(this.PC.value, encodedBytes);
					this.PC.value += encodedBytes.length;
				} catch (e) {
					const errorMessage = e instanceof Error ? e.message : String(e);
					throw new Error(`line ${mnemonicToken.line}: Invalid instruction syntax or unresolved symbol. Error: ${errorMessage}`);
				}
			} else {
				// Not assembling: just advance PC
				this.PC.value += this.getInstructionSize();
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
					PC: this.PC,
					macroArgs: (this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState).macroArgs,
					currentLabel: this.lastGlobalLabel, // Added for instruction size evaluation
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
						PC: this.PC,
						macroArgs: macroArgs,
						currentLabel: this.lastGlobalLabel,
					});

					const argTokens = macroArgs.get(token.value) ?? [];

					const expressions = argTokens[0]?.value as Token[][];

					if (indexValue < 0 || indexValue >= expressions.length)
						throw new Error(`line ${token.line}: Macro argument index ${indexValue} out of bounds for argument '${token.value}'.`);

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
