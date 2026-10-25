import { EventEmitter } from "node:events";
import type { CPUHandler } from "../cpu/cpuhandler.interface";
import type { DirectiveContext, DirectiveRuntime } from "../directives/directive.interface";
import { DirectiveHandler } from "../directives/handler";
import { MacroHandler } from "../directives/macro/handler";
import { isTextArg, markAsText } from "../directives/macro/text-arg";
import { ConsoleSink } from "../helpers/consolesink.class";
import { ErrorLocator } from "../helpers/error-locator.class";
import { Lister } from "../helpers/lister.class";
import { Logger } from "../helpers/logger.class";
import { StreamManager } from "../helpers/stream-manager.class";
import { Linker, type Segment } from "../linker/linker.class";
import type { OperatorStackToken, ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";
import { ExpressionEvaluator } from "./expression";
import type { ValueHolder } from "./expression.types";
import { NamelessLabels } from "./namelesslabels.class";
import { Parser, ParserError } from "./parser.class";
import type { AssemblerOptions, DataProcessor, FileHandler, SegmentDefinition, StreamState } from "./polyasm.types";
import { PASymbolTable } from "./symbol.class";

const DEFAULT_PC = 0x1000;

export class Assembler {
	public logger: Logger;
	public lister: Lister;
	public parser: Parser;
	public linker: Linker;
	public streamManager: StreamManager;
	private cpuHandler: CPUHandler;
	/** The CPU and segments given to the constructor: each assemble() starts from them. */
	private readonly initialCpuHandler: CPUHandler;
	private readonly segmentDefinitions: SegmentDefinition[];
	private hasAssembled = false;
	/** Where pass 1 started: pass 2 starts with the same current segment and PC. */
	private passStart: { segment: Segment | undefined; PC: number } = { segment: undefined, PC: DEFAULT_PC };
	public fileHandler: FileHandler;

	public symbolTable: PASymbolTable;
	private PC: ValueHolder = { value: 0 };

	public lastGlobalLabel: string | null = null;
	private lastGlobalLabelLine: string | number = 0;
	/** The first token of the statement being assembled: where an error is reported when it doesn't say better. */
	private statementToken: Token | undefined;
	public namelessLabels: NamelessLabels = new NamelessLabels();

	public pass: number;

	private wannaLogPass1 = false;
	private wannaLogPass2 = false;
	private wannaLogLinker = false;

	public expressionEvaluator: ExpressionEvaluator;
	public directiveHandler: DirectiveHandler;
	public macroHandler: MacroHandler;
	private errorLocator: ErrorLocator;
	private rawDataProcessors?: Map<string, DataProcessor>;
	private defaultRawDataProcessor = "";
	public emitter: EventEmitter;

	constructor(handler: CPUHandler, fileHandler: FileHandler, options?: AssemblerOptions) {
		this.cpuHandler = handler;
		this.initialCpuHandler = handler;
		this.segmentDefinitions = options?.segments ?? [];
		this.fileHandler = fileHandler;
		this.logger =
			options?.logger ??
			new Logger({
				sink: new ConsoleSink(),
				enabled: true,
				cached: false,
			});
		this.lister = new Lister(this.logger);

		this.linker = new Linker(DEFAULT_PC, this.fileHandler);
		this.PC = this.linker.PC;

		if (options?.rawDataProcessors) {
			this.rawDataProcessors = options.rawDataProcessors.map;
			this.defaultRawDataProcessor = options.rawDataProcessors.default || "";
			if (!this.rawDataProcessors.has(this.defaultRawDataProcessor)) throw new Error("Default data processor not found.");
		}

		this.symbolTable = new PASymbolTable(this.lister, () => this.streamManager.includeStack);

		this.expressionEvaluator = new ExpressionEvaluator(this.symbolTable, {
			resolveSysValue: (nameToken) => this.resolveSysValue(nameToken),
			findSegment: (name) => this.linker.findSegment(name),
			findNearestLabel: (address, distance) => this.namelessLabels.findNearest(address, distance),
			isMacroDefined: (name) => this.macroHandler.isDefined(name),
		});

		this.emitter = new EventEmitter();
		this.parser = new Parser(this.emitter);
		this.streamManager = new StreamManager(this.fileHandler, this.parser);

		this.macroHandler = new MacroHandler(this.parser, this.symbolTable, this.lister, options?.maxMacroDepth, (tokens, macroArgs) =>
			this.substituteArgument(tokens, macroArgs),
		);
		this.errorLocator = new ErrorLocator(this.parser, this.macroHandler, () => this.statementToken, this.streamManager);

		const runtime: DirectiveRuntime = {
			parser: this.parser,
			symbolTable: this.symbolTable,
			evaluator: this.expressionEvaluator,
			lister: this.lister,
			logger: this.logger,
			linker: this.linker,
			macroHandler: this.macroHandler,
			warn: (message, position) => this.warn(message, position),
			includeStack: () => this.streamManager.includeStack,
		};
		this.directiveHandler = new DirectiveHandler(this, runtime);

		this.pass = -1;

		this.addConfiguredSegments();

		if (options?.log?.pass1Enabled) this.wannaLogPass1 = true;
		if (options?.log?.pass2Enabled) this.wannaLogPass2 = true;
		if (options?.log?.linkerEnabled) this.wannaLogLinker = true;
	}

	/** The first token of the statement being assembled: where its errors are located. */
	public get currentStatement(): Token | undefined {
		return this.statementToken;
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
				return this.streamManager.currentFilename;

			case "FILEPATH":
				return this.streamManager.currentFilepath;

			default:
				throw AsmError.at(`Unknown system variable: ${nameToken.value}.`, nameToken);
		}
	}

	/** Convenience: add a segment via the embedded linker. */
	public addSegment(name: string, start: number, size: number, padValue = 0, resizable = false): void {
		this.linker.addSegment(name, start, size, padValue, resizable);
	}

	/** Convenience: link segments via the linker. */
	public link(segments?: Segment[]): number[] {
		const isLogEnabled = this.logger.enabled;
		this.logger.enabled = isLogEnabled && this.wannaLogLinker;
		try {
			return this.linker.rawBinaryLink(segments, this.logger);
		} finally {
			this.logger.enabled = isLogEnabled;
		}
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
		const key = `option:${name}`;
		this.emitter.emit(key, value);
		this.lister.directive("option", `${name} = "${value}"`);
	}

	public setCPUHandler(handler: CPUHandler) {
		this.cpuHandler = handler;
	}

	public getCPUHandler(): CPUHandler {
		return this.cpuHandler;
	}

	private addConfiguredSegments() {
		for (const seg of this.segmentDefinitions) this.linker.addSegment(seg.name, seg.start, seg.size, seg.padValue, seg.resizable);
		if (this.segmentDefinitions[0]) this.linker.useSegment(this.segmentDefinitions[0].name);
	}

	/** Back to the state after construction: no symbols, macros or emitted code, the initial CPU and segments. */
	private reset() {
		this.symbolTable.reset();
		this.macroHandler.macroDefinitions.clear();
		this.linker.reset();
		this.addConfiguredSegments();
		this.cpuHandler = this.initialCpuHandler;
	}

	public assemble(source: string): Segment[] {
		// Each call is independent: the same instance can assemble again, or assemble another source.
		// Setup done before the first call (e.g. predefined symbols) is kept.
		if (this.hasAssembled) this.reset();
		this.hasAssembled = true;
		// Reading included files moves the file handler's current file: restore it when done.
		const { fullpath, filename } = this.fileHandler;

		const isLogEnabled = this.logger.enabled;
		this.logger.enabled = isLogEnabled && this.wannaLogPass1;

		this.setOption("local_label_char", ":");

		// Initialize or re-initialize the lexer
		this.streamManager.start(source, this.fileHandler.fullpath, this.fileHandler.filename);

		try {
			this.passOne();

			// Ensure there's at least one segment: if none defined, create a default growable segment starting at 0
			if (!this.linker.segments || this.linker.segments.length === 0) {
				this.linker.addSegment("CODE", DEFAULT_PC, 0, 0, true);
				this.linker.useSegment("CODE");
				// Pass 1 started at DEFAULT_PC with no segment: this one stands for it.
				this.passStart.segment = this.linker.currentSegment;
			}

			this.linker.resetModules();

			// Reset stream stack for Pass 2 (fresh position)
			this.streamManager.restart();
			this.logger.enabled = isLogEnabled && this.wannaLogPass2;

			this.passTwo();

			this.logger.enabled = isLogEnabled;
		} catch (e) {
			throw this.errorLocator.toAsmError(e);
		} finally {
			// Symbols set up between two assemblies are known in both passes of the next one.
			this.symbolTable.pass = 0;
			this.fileHandler.fullpath = fullpath;
			this.fileHandler.filename = filename;
		}

		this.logger.log("\n--- Assembly Complete ---");

		return this.linker.segments;
	}

	/** Reports a warning, located like an error: at `position`, else at the current statement. */
	public warn(message: string, position?: { line: number | string; column: number }) {
		this.logger.warn(this.errorLocator.warning(message, position));
	}

	private passOne(): void {
		this.logger.log("\n--- Starting Pass 1: PASymbol Definition & PC Calculation ---");

		this.symbolTable.setNamespace("global");

		this.pass = 1;
		this.symbolTable.pass = 1;
		this.statementToken = undefined;
		this.namelessLabels.clear();
		this.macroHandler.rewind();
		this.lastGlobalLabel = null;

		let blockDepth = 0;

		if (this.linker.segments.length) this.PC.value = this.linker.segments[0] ? this.linker.segments[0].start : DEFAULT_PC;
		this.passStart = { segment: this.linker.currentSegment, PC: this.PC.value };
		this.linker.resetSegmentPositions();

		while (this.parser.tokenStreamStack.length > 0) {
			const token = this.parser.next();
			// If no token or EOF, pop the active stream
			if (!token || token.type === "EOF") {
				this.lastGlobalLabelLine = -1;
				const poppedStream = this.parser.popTokenStream(false); // Don't emit event yet
				if (this.parser.tokenStreamStack.length === 0) break;
				if (poppedStream) this.emitter.emit(`endOfStream:${poppedStream.id}`);
				continue;
			}
			this.statementToken = token;

			switch (token.type) {
				case "DOT": {
					const directiveToken = this.parser.next() as ScalarToken;
					if (directiveToken?.type !== "IDENTIFIER")
						throw new ParserError(`Expected a directive name after '.', got '${directiveToken.value}'.`, directiveToken);

					const directiveContext: DirectiveContext = {
						filename: this.streamManager.currentFilepath,
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
							filename: this.streamManager.currentFilepath,
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
					const mnemonic = this.joinMnemonicSuffix(token as ScalarToken);
					if (this.cpuHandler.isInstruction(mnemonic.value)) {
						this.handleInstructionPassOne(mnemonic);
						break;
					}

					// PRIORITY 3: ... OR LABEL
					// It's not a known instruction, so treat it as a label definition.
					if (this.lastGlobalLabel && this.lastGlobalLabelLine === token.line)
						throw new ParserError(`Syntax error - (Unknown opcode?) Unexpected label '${token.value}' after ${this.lastGlobalLabel}`, token);

					this.lastGlobalLabel = token.value;
					this.lastGlobalLabelLine = token.line;
					if (!this.parser.isOperator("=") && !this.parser.isDirective("EQU")) {
						this.symbolTable.defineConstant(token.value, this.PC.value, {
							filename: this.streamManager.currentFilepath,
							line: token.line,
							column: token.column,
						});
						this.lister.label(token.raw ?? token.value, this.PC.value);
					}
					break;
				}
				case "LABEL": {
					this.lastGlobalLabel = token.value;
					this.lastGlobalLabelLine = token.line;
					this.symbolTable.defineConstant(token.value, this.PC.value, {
						filename: this.streamManager.currentFilepath,
						line: token.line,
						column: token.column,
					});
					this.lister.label(token.raw ?? token.value, this.PC.value);
					break;
				}

				case "LOCAL_LABEL": {
					if (!this.lastGlobalLabel) throw new ParserError(`Local label ':${token.value}' defined without a preceding global label.`, token);

					const qualifiedName = `${this.lastGlobalLabel}.${token.value}`;
					this.symbolTable.defineConstant(qualifiedName, this.PC.value, {
						filename: this.streamManager.currentFilepath,
						line: token.line,
						column: token.column,
					});
					break;
				}

				case "ANONYMOUS_LABEL_DEF": {
					this.namelessLabels.add(this.PC.value);
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
		this.symbolTable.pass = 2;
		this.statementToken = undefined;
		this.namelessLabels.rewind();
		this.macroHandler.rewind();
		// Start where pass 1 started, not where it ended (the last .segment used) nor at a segment the source defined.
		this.linker.currentSegment = this.passStart.segment;
		this.PC.value = this.passStart.PC;
		this.linker.resetSegmentPositions();

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
			this.statementToken = token;

			switch (token.type) {
				case "OPERATOR": {
					if (token.value === "*") {
						this.lastGlobalLabel = "*";
						break;
					}

					if (token.value === "=" && this.lastGlobalLabel) {
						const directiveContext: DirectiveContext = {
							filename: this.streamManager.currentFilepath,
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

					throw new Error(`Unexpected operator '${token.value}'.`);
				}

				case "IDENTIFIER": {
					if (this.macroHandler.isMacro(token.value)) {
						this.macroHandler.expandMacro(token);
						break;
					}

					const mnemonic = this.joinMnemonicSuffix(token as ScalarToken);
					if (this.cpuHandler.isInstruction(mnemonic.value)) {
						this.handleInstructionPassTwo(mnemonic as OperatorStackToken);
						break;
					}

					this.lastGlobalLabel = token.value;
					if (!this.parser.isOperator("=") && !this.parser.isDirective("EQU")) {
						// In functions, the scope is lost between the passes
						if (this.symbolTable.hasSymbolInScope(token.value)) {
							this.checkLabelPhase(token.value);
							this.symbolTable.updateSymbol(token.value, this.PC.value);
						} else
							this.symbolTable.defineConstant(token.value, this.PC.value, {
								filename: this.streamManager.currentFilepath,
								line: token.line,
								column: token.column,
							});
						this.lister.label(token.raw ?? token.value, this.PC.value);
					}
					break;
				}

				case "DOT": {
					const directiveToken = this.parser.next() as ScalarToken;
					if (directiveToken?.type !== "IDENTIFIER")
						throw new ParserError(`Expected a directive name after '.', got '${directiveToken.value}'.`, directiveToken);

					const streamBefore = this.parser.tokenStreamStack.length;
					const directiveContext: DirectiveContext = {
						filename: this.streamManager.currentFilepath,
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
					if (this.symbolTable.hasSymbolInScope(token.value)) {
						this.checkLabelPhase(token.value);
						this.symbolTable.updateSymbol(token.value, this.PC.value);
					} else
						this.symbolTable.defineConstant(token.value, this.PC.value, {
							filename: this.streamManager.currentFilepath,
							line: token.line,
							column: token.column,
						});

					this.lister.label(token.raw ?? token.value, this.PC.value);

					break;
				}

				case "LOCAL_LABEL": {
					// Same as a global label, under the name pass 1 gave it.
					const qualifiedName = `${this.lastGlobalLabel}.${token.value}`;
					if (this.symbolTable.hasSymbolInScope(qualifiedName)) {
						this.checkLabelPhase(qualifiedName, `local label '${token.raw ?? token.value}' of '${this.lastGlobalLabel}'`);
						this.symbolTable.updateSymbol(qualifiedName, this.PC.value);
					} else
						this.symbolTable.defineConstant(qualifiedName, this.PC.value, {
							filename: this.streamManager.currentFilepath,
							line: token.line,
							column: token.column,
						});
					break;
				}

				case "ANONYMOUS_LABEL_DEF": {
					const pass1Address = this.namelessLabels.update(this.PC.value);
					if (pass1Address !== undefined && pass1Address !== this.PC.value) throw this.phaseError("anonymous label", pass1Address);
					break;
				}
			}
		}
	}

	/**
	 * Pass 2: a label must have the same address as in pass 1. If it moved, code before it changed size
	 * between the passes, and every forward reference to it was assembled with the pass-1 address.
	 */
	private checkLabelPhase(symbolName: string, description = `label '${symbolName}'`) {
		const pass1Value = this.symbolTable.lookupSymbol(symbolName);
		if (typeof pass1Value === "number" && pass1Value !== this.PC.value) throw this.phaseError(description, pass1Value);
	}

	private phaseError(description: string, pass1Value: number) {
		return new Error(
			`Phase error: ${description} is $${getHex(pass1Value)} in pass 1 but $${getHex(this.PC.value)} in pass 2. Code before it changed size between the passes, usually because a symbol is used before it is defined: define that symbol earlier.`,
		);
	}

	/**
	 * An instruction with a suffix (`lda.b`) is lexed as LDA, '.', B. When they're written together, joins them
	 * into one mnemonic for the CPU: a suffix the CPU doesn't declare is an error.
	 */
	private joinMnemonicSuffix(token: ScalarToken): ScalarToken {
		const dot = this.parser.peek();
		if (dot?.type !== "DOT" || dot.line !== token.line || dot.column !== token.column + (token.raw ?? token.value).length) return token;
		const suffix = this.parser.peek(1);
		if (suffix?.type !== "IDENTIFIER" || suffix.line !== token.line || suffix.column !== dot.column + 1) return token;
		if (!this.cpuHandler.isInstruction(token.value)) return token;

		const suffixes = this.cpuHandler.mnemonicSuffixes ?? [];
		if (!suffixes.includes(suffix.value)) {
			const known = suffixes.length ? ` (it has ${suffixes.map((s) => `.${s}`).join(", ")})` : "";
			throw new ParserError(`'${token.value}.${suffix.value}': the ${this.cpuHandler.cpuType} has no '.${suffix.value}' suffix${known}.`, token);
		}

		this.parser.advance(2);
		return {
			...token,
			value: `${token.value}.${suffix.value}`,
			raw: `${token.raw ?? token.value}.${suffix.raw ?? suffix.value}`,
		};
	}

	private handleInstructionPassOne(mnemonicToken: ScalarToken): void {
		let operandTokens = this.parser.getInstructionTokens(mnemonicToken) as OperatorStackToken[];

		const currentStream = this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState;
		if (currentStream.macroArgs) operandTokens = this.substituteTokens(operandTokens, currentStream.macroArgs) as OperatorStackToken[];

		const instructionPC = this.PC.value;

		// It's an instruction. Resolve its size and advance the PC.
		const sizeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, (exprTokens, numberMax = 0) =>
			this.expressionEvaluator.evaluateAsNumber(exprTokens, {
				PC: this.PC,
				allowForwardRef: true,
				currentLabel: this.lastGlobalLabel,
				macroArgs: currentStream.macroArgs,
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
	}

	private handleInstructionPassTwo(mnemonicToken: OperatorStackToken): void {
		{
			const instructionPC = this.PC.value;
			// It's an instruction.
			let operandTokens = this.parser.getInstructionTokens(mnemonicToken) as OperatorStackToken[];

			const currentStream = this.parser.tokenStreamStack[this.parser.tokenStreamStack.length - 1] as StreamState;
			if (currentStream.macroArgs) operandTokens = this.substituteTokens(operandTokens, currentStream.macroArgs) as OperatorStackToken[];

			// 1. Resolve Mode & Address
			const modeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, (exprTokens, numberMax = 0) =>
				this.expressionEvaluator.evaluateAsNumber(exprTokens, {
					PC: this.PC,
					currentLabel: this.lastGlobalLabel,
					macroArgs: currentStream.macroArgs,
					numberMax,
				}),
			);

			// 2. Encode Bytes using resolved info. Every symbol is known in pass 2, so is the operand.
			const { resolvedAddress } = modeInfo;
			if (resolvedAddress === null) throw new Error(`Internal error: the operand of '${mnemonicToken.value}' is still unknown in pass 2.`);
			const encodedBytes = this.cpuHandler.encodeInstruction([mnemonicToken, ...operandTokens], {
				...modeInfo,
				resolvedAddress,
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
		}
	}

	/**
	 * The macro parameters in an instruction's operand: a text argument is pasted, a value is left to the evaluator,
	 * as in a directive. `lda src*2` with `src` = `1+2` is `lda 6`.
	 */
	private substituteTokens(tokens: Token[], macroArgs: Map<string, Token[]>): Token[] {
		return this.replaceMacroArgs(tokens, macroArgs, (argTokens, reference) => (isTextArg(argTokens) ? argTokens : reference));
	}

	/**
	 * The macro parameters in an argument of a nested macro call: they are pasted, as that argument is evaluated without them.
	 * A value is pasted in ( ), unless it's one token or goes in a text argument: `inner src*2` with `src` = `1+2` passes 6.
	 * An argument that is only a text parameter stays text.
	 */
	private substituteArgument(tokens: Token[], macroArgs: Map<string, Token[]>): Token[] {
		const intoText = isTextArg(tokens);
		let forwardsText = false;
		const result = this.replaceMacroArgs(tokens, macroArgs, (argTokens, reference) => {
			if (isTextArg(argTokens)) {
				forwardsText = reference.length === tokens.length;
				return argTokens;
			}
			if (intoText || argTokens.length <= 1) return argTokens;
			const { line, column } = reference[0] as Token;
			return [{ type: "OPERATOR", value: "(", line, column }, ...argTokens, { type: "OPERATOR", value: ")", line, column }];
		});
		return intoText || forwardsText ? markAsText(result) : result;
	}

	/** Replaces each macro parameter in `tokens`, or element of its rest parameter (`p[1]`), by what `replace` gives for its argument. */
	private replaceMacroArgs(tokens: Token[], macroArgs: Map<string, Token[]>, replace: (argTokens: Token[], reference: Token[]) => Token[]): Token[] {
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
						throw new Error(`Macro argument index ${indexValue} out of bounds for argument '${token.value}'.`);

					result.push(...replace(expressions[indexValue] as Token[], tokens.slice(i, j + 1)));
					i = j; // Advance main loop past `]`
					continue;
				}
			}

			// If not array access, it's a simple substitution
			result.push(...replace(macroArgs.get(token.value) ?? [], [token]));
		}
		return result;
	}
}
