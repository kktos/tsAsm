import { EventEmitter } from "node:events";
import type { CPUHandler, OperandReader } from "../cpu/cpuhandler.interface";
import type { DirectiveContext, DirectiveRuntime } from "../directives/directive.interface";
import { DirectiveHandler } from "../directives/handler";
import { MacroHandler } from "../directives/macro/handler";
import { isTextArg, markAsText } from "../directives/macro/text-arg";
import { ConsoleSink } from "../helpers/consolesink.class";
import { ErrorLocator } from "../helpers/error-locator.class";
import { Lister } from "../helpers/lister.class";
import { Logger } from "../helpers/logger.class";
import { StreamManager } from "../helpers/stream-manager.class";
import { Linker, type Segment, type SegmentAttributes, type SegmentParams } from "../linker/linker.class";
import type { OperatorStackToken, ScalarToken, Token } from "../shared/lexer/lexer.class";
import { AsmError } from "../utils/error.utils";
import { getHex } from "../utils/hex.util";
import { ExpressionEvaluator } from "./expression";
import type { ValueHolder } from "./expression.types";
import { NamelessLabels } from "./namelesslabels.class";
import { LOCAL_OPTIONS, type LocalOptions, type OptionName, type OptionValue, withDefaultOptions } from "./options";
import { Parser, ParserError } from "./parser.class";
import type { AssemblerOptions, DataProcessor, FileHandler, FunctionCall, SegmentDefinition, StreamState } from "./polyasm.types";
import { noFixupError, RelocValue } from "./reloc-value.class";
import { PASymbolTable, type SymbolValue } from "./symbol.class";
import type { UserFunction } from "./user-function.class";

const DEFAULT_PC = 0x1000;

/** An address in a message: `$10000`, not getHex's `00010000`; a negative one in decimal. */
const formatAddress = (address: number) => (address < 0 ? String(address) : `$${address.toString(16).toUpperCase()}`);

/** The directives a function's body can run: it only computes a value, so none that emits, defines a label or a scope, or changes a setting. */
const FUNCTION_DIRECTIVES = new Set([
	"IF",
	"END",
	"REPEAT",
	"FOR",
	"BREAK",
	"RETURN",
	"LET",
	"LOG",
	"ECHO",
	"OUT",
	"ERROR",
	"ERR",
	"WARNING",
	"WARN",
	"ASSERT",
]);
const FUNCTION_ONLY = "a function only computes a value";

export class Assembler {
	public logger: Logger;
	public lister: Lister;
	public parser: Parser;
	public linker: Linker;
	public streamManager: StreamManager;
	private cpuHandler: CPUHandler;
	/** The CPUs given to the constructor: the ones `.cpu` can switch to. */
	private readonly cpuHandlers: CPUHandler[];
	/** The CPU and segments given to the constructor: each assemble() starts from them. */
	private readonly initialCpuHandler: CPUHandler;
	private readonly segmentDefinitions: SegmentDefinition[];
	/** The `.option` values each pass starts with. */
	private readonly initialOptions: Record<OptionName, OptionValue>;
	/** The `.option` values in effect. */
	private currentOptions: Record<OptionName, OptionValue>;
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

	/** `cpus`: the CPUs `.cpu` can switch to. The source starts with the one `options.cpu` names, else the first. */
	constructor(cpus: CPUHandler | CPUHandler[], fileHandler: FileHandler, options?: AssemblerOptions) {
		this.cpuHandlers = Array.isArray(cpus) ? cpus : [cpus];
		const [firstCpu] = this.cpuHandlers;
		if (!firstCpu) throw new Error("The assembler needs a CPU.");
		const names = new Set<string>();
		for (const { cpuType } of this.cpuHandlers) {
			if (names.has(cpuType.toUpperCase())) throw new Error(`Two CPUs are named '${cpuType}'.`);
			names.add(cpuType.toUpperCase());
		}
		this.initialCpuHandler = options?.cpu === undefined ? firstCpu : this.findCPUHandler(options.cpu);
		this.cpuHandler = this.initialCpuHandler;
		this.segmentDefinitions = options?.segments ?? [];
		this.initialOptions = withDefaultOptions(options?.options);
		this.currentOptions = { ...this.initialOptions };
		this.fileHandler = fileHandler;
		this.logger =
			options?.logger ??
			new Logger({
				sink: new ConsoleSink(),
				enabled: true,
				cached: false,
			});
		this.emitter = new EventEmitter();
		this.lister = new Lister(this.logger, this.emitter);

		this.linker = new Linker(DEFAULT_PC, this.fileHandler, (name) => this.symbolTable.lookupGlobalSymbol(name));
		this.PC = this.linker.PC;

		if (options?.rawDataProcessors) {
			this.rawDataProcessors = options.rawDataProcessors.map;
			this.defaultRawDataProcessor = options.rawDataProcessors.default || "";
			if (!this.rawDataProcessors.has(this.defaultRawDataProcessor)) throw new Error("Default data processor not found.");
		}

		this.symbolTable = new PASymbolTable(this.lister, (source) => this.errorLocator.definitionSite(source));

		this.expressionEvaluator = new ExpressionEvaluator(this.symbolTable, {
			resolveSysValue: (nameToken) => this.resolveSysValue(nameToken),
			addressValue: (address) => this.addressValue(address),
			findSegment: (name) => this.linker.findSegment(name),
			findNearestLabel: (address, distance) => this.namelessLabels.findNearest(address, distance),
			isMacroDefined: (name) => this.macroHandler.isDefined(name),
			functionRecursion: () => this.currentOptions["function.recursion"] as number,
			runFunction: (fn) => this.runFunction(fn),
		});

		this.parser = new Parser(this.emitter);
		this.streamManager = new StreamManager(this.fileHandler, this.parser);

		this.macroHandler = new MacroHandler(
			this.parser,
			this.symbolTable,
			this.lister,
			options?.maxMacroDepth,
			(tokens, macroArgs) => this.substituteArgument(tokens, macroArgs),
			(options) => this.useLocalOptions(options),
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
			option: (name) => this.currentOptions[name],
			warn: (message, position) => this.warn(message, position),
			currentStatement: () => this.statementToken,
			definitionSite: (position) => this.errorLocator.definitionSite(position),
			includeSites: (position) => this.errorLocator.includeSites(position),
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
				return this.addressValue(this.PC.value);

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

	/** An address in the current segment: in a relocatable one, its offset there (`CODE+$0012`), as it has no address until it's loaded. */
	public addressValue(address: number): number | RelocValue {
		const segment = this.linker.currentSegment;
		return segment?.relocatable ? new RelocValue(segment.name, address) : address;
	}

	/** Convenience: add a segment via the embedded linker. */
	public addSegment(name: string, params: SegmentParams = {}): void {
		this.linker.addSegment(name, params);
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

	/** Options are broadcast as "option:<name>" events. They take effect from the next statement on. */
	public setOption(name: OptionName, value: OptionValue) {
		this.applyOption(name, value);
		this.lister.directive("option", `${name} = ${JSON.stringify(value)}`);
	}

	private applyOption(name: OptionName, value: OptionValue) {
		this.currentOptions[name] = value;
		this.emitter.emit(`option:${name}`, value);
	}

	/**
	 * Sets the local options to `options`, by default the ones the assembler was given, until the function it returns
	 * puts back the ones in effect: for an included file or a macro body, see `LOCAL_OPTIONS`.
	 */
	public useLocalOptions(options: LocalOptions = this.initialOptions): () => void {
		const previous = LOCAL_OPTIONS.map((name) => [name, this.currentOptions[name]] as const);
		for (const name of LOCAL_OPTIONS) this.applyOption(name, options[name]);
		return () => {
			for (const [name, value] of previous) this.applyOption(name, value);
		};
	}

	/**
	 * Each pass starts with the CPU the assembler was given: pass 2 doesn't start with the one pass 1 ended with. Every
	 * CPU's state starts as after reset: the handlers are the same each pass, and each assemble().
	 */
	private resetCPU() {
		this.cpuHandler = this.initialCpuHandler;
		for (const cpu of this.cpuHandlers) cpu.resetState?.();
	}

	/** Each pass starts with the options the assembler was given: the passes read the `.option`s in the same order. */
	private resetOptions() {
		for (const [name, value] of Object.entries(this.initialOptions)) this.applyOption(name as OptionName, value);
	}

	public setCPUHandler(handler: CPUHandler) {
		this.cpuHandler = handler;
	}

	public getCPUHandler(): CPUHandler {
		return this.cpuHandler;
	}

	/** `.org` and `* =`: an address in the current CPU's address space. */
	public checkAddress(address: number) {
		const max = 2 ** this.cpuHandler.addressBits - 1;
		if (address < 0 || address > max)
			throw new Error(`Address ${formatAddress(address)} is outside the ${this.cpuHandler.cpuType}'s address space ($0..$${getHex(max)}).`);
	}

	/** After each statement: its bytes end at the top of the CPU's address space at most. */
	private checkPCRange() {
		const end = 2 ** this.cpuHandler.addressBits;
		if (this.PC.value > end)
			throw new Error(
				`The PC goes past $${getHex(end - 1)}, the top of the ${this.cpuHandler.cpuType}'s address space, to ${formatAddress(this.PC.value)}.`,
			);
	}

	/** The CPUs given to the constructor. */
	public get cpus(): readonly CPUHandler[] {
		return this.cpuHandlers;
	}

	/** The CPU given to the constructor with this name, in any case. */
	public findCPUHandler(name: string): CPUHandler {
		const upperName = name.toUpperCase();
		const handler = this.cpuHandlers.find((cpu) => cpu.cpuType.toUpperCase() === upperName);
		if (!handler) throw new Error(`Unknown CPU name '${name}': the CPUs are ${this.cpuHandlers.map((cpu) => cpu.cpuType).join(", ")}.`);
		return handler;
	}

	private addConfiguredSegments() {
		for (const seg of this.segmentDefinitions) {
			if (seg.reloc !== undefined && seg.relocatable !== undefined)
				throw new Error(`Segment '${seg.name}' gives 'relocatable' twice ('reloc' is the same property).`);
			const attrs = segmentAttributes(seg);

			// A relocatable segment has no address until it's loaded: it starts at 0, and grows without a size.
			if (seg.relocatable ?? seg.reloc) {
				if (seg.start !== undefined)
					throw new Error(`Segment '${seg.name}' is relocatable: it has no 'start', its address is only known when it's loaded.`);
				this.linker.addSegment(seg.name, {
					size: seg.size,
					padValue: seg.padValue,
					resizable: seg.size === undefined || seg.resizable,
					relocatable: true,
					attrs,
				});
				continue;
			}

			if (seg.start === undefined) throw new Error(`Segment '${seg.name}' needs a 'start' address, or 'relocatable: true'.`);
			if (seg.size === undefined) throw new Error(`Segment '${seg.name}' needs a 'size'.`);
			this.linker.addSegment(seg.name, { start: seg.start, size: seg.size, padValue: seg.padValue, resizable: seg.resizable, attrs });
		}
		if (this.segmentDefinitions[0]) this.linker.useSegment(this.segmentDefinitions[0].name);
	}

	/** Back to the state after construction: no symbols, macros or emitted code, the initial segments. */
	private reset() {
		this.symbolTable.reset();
		this.macroHandler.macroDefinitions.clear();
		this.linker.reset();
		this.addConfiguredSegments();
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

		// Initialize or re-initialize the lexer
		this.streamManager.start(source, this.fileHandler.fullpath, this.fileHandler.filename);

		try {
			this.passOne();

			// Ensure there's at least one segment: if none defined, create a default growable segment starting at 0
			if (!this.linker.segments || this.linker.segments.length === 0) {
				this.linker.addSegment("CODE", { start: DEFAULT_PC, resizable: true });
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
			// The listing shows what ran up to the error
			this.lister.endLoops();
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
		this.resetCPU();
		this.resetOptions();
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
					this.parser.checkDirectiveSpacing(token, directiveToken);

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
						this.symbolTable.defineLabel(token.value, this.addressValue(this.PC.value), {
							filename: this.streamManager.currentFilepath,
							line: token.line,
							column: token.column,
						});
						this.lister.label(token.raw ?? token.value, this.addressValue(this.PC.value));
					}
					break;
				}
				case "LABEL": {
					this.lastGlobalLabel = token.value;
					this.lastGlobalLabelLine = token.line;
					this.symbolTable.defineLabel(token.value, this.addressValue(this.PC.value), {
						filename: this.streamManager.currentFilepath,
						line: token.line,
						column: token.column,
					});
					this.lister.label(token.raw ?? token.value, this.addressValue(this.PC.value));
					break;
				}

				case "LOCAL_LABEL": {
					if (!this.lastGlobalLabel)
						throw new ParserError(`Local label '${token.raw ?? token.value}' defined without a preceding global label.`, token);

					const qualifiedName = `${this.lastGlobalLabel}.${token.value}`;
					this.symbolTable.defineLabel(qualifiedName, this.addressValue(this.PC.value), {
						filename: this.streamManager.currentFilepath,
						line: token.line,
						column: token.column,
					});
					this.lister.label(token.raw ?? token.value, this.addressValue(this.PC.value));
					break;
				}

				case "ANONYMOUS_LABEL_DEF": {
					this.namelessLabels.add(this.PC.value);
					this.lister.label(token.value, this.addressValue(this.PC.value));
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
			this.checkPCRange();
		}
		if (blockDepth !== 0) throw new ParserError(`Syntax error : Unbalanced braces. Depth: ${blockDepth}`);
	}

	private passTwo(): void {
		this.logger.log("\n--- Starting Pass 2: Code Generation ---");
		this.pass = 2;
		this.symbolTable.pass = 2;
		this.statementToken = undefined;
		this.resetCPU();
		this.resetOptions();
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
							this.symbolTable.updateSymbol(token.value, this.addressValue(this.PC.value));
						} else
							this.symbolTable.defineLabel(token.value, this.addressValue(this.PC.value), {
								filename: this.streamManager.currentFilepath,
								line: token.line,
								column: token.column,
							});
						this.lister.label(token.raw ?? token.value, this.addressValue(this.PC.value));
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
						this.symbolTable.updateSymbol(token.value, this.addressValue(this.PC.value));
					} else
						this.symbolTable.defineLabel(token.value, this.addressValue(this.PC.value), {
							filename: this.streamManager.currentFilepath,
							line: token.line,
							column: token.column,
						});

					this.lister.label(token.raw ?? token.value, this.addressValue(this.PC.value));

					break;
				}

				case "LOCAL_LABEL": {
					// Same as a global label, under the name pass 1 gave it.
					const qualifiedName = `${this.lastGlobalLabel}.${token.value}`;
					if (this.symbolTable.hasSymbolInScope(qualifiedName)) {
						this.checkLabelPhase(qualifiedName, `local label '${token.raw ?? token.value}' of '${this.lastGlobalLabel}'`);
						this.symbolTable.updateSymbol(qualifiedName, this.addressValue(this.PC.value));
					} else
						this.symbolTable.defineLabel(qualifiedName, this.addressValue(this.PC.value), {
							filename: this.streamManager.currentFilepath,
							line: token.line,
							column: token.column,
						});
					this.lister.label(token.raw ?? token.value, this.addressValue(this.PC.value));
					break;
				}

				case "ANONYMOUS_LABEL_DEF": {
					const pass1Address = this.namelessLabels.update(this.PC.value);
					if (pass1Address !== undefined && pass1Address !== this.PC.value) throw this.phaseError("anonymous label", pass1Address);
					this.lister.label(token.value, this.addressValue(this.PC.value));
					break;
				}
			}
			this.checkPCRange();
		}
	}

	/**
	 * Runs the body of a block function, in the call's scope the evaluator set up, up to its `.return`: the value it gives.
	 * The body is a stream of its own, run here to its end while the statement calling the function waits, with the local
	 * options of where it's defined, unlisted. An instruction, a label, a macro call or a directive that isn't about
	 * computing a value is an error.
	 */
	private runFunction(fn: UserFunction): SymbolValue {
		const parser = this.parser;
		const depth = parser.tokenStreamStack.length;
		const caller = { statement: this.statementToken, label: this.lastGlobalLabel, labelLine: this.lastGlobalLabelLine };
		const functionCall: FunctionCall = { name: fn.name };
		const restoreOptions = this.useLocalOptions(fn.options);
		const unmute = this.lister.mute();
		this.lastGlobalLabel = null;
		parser.pushTokenStream({ newTokens: [...fn.body], macroArgs: fn.macroArgs, functionCall });

		try {
			while (parser.tokenStreamStack.length > depth) {
				const token = parser.next();
				if (!token || token.type === "EOF") {
					const poppedStream = parser.popTokenStream(false);
					if (poppedStream) this.emitter.emit(`endOfStream:${poppedStream.id}`);
					continue;
				}
				this.statementToken = token;
				try {
					this.runFunctionStatement(token);
				} catch (e) {
					// Located in the body: the assembler would locate it at the statement calling the function.
					const error = e instanceof AsmError ? e : new AsmError(e instanceof Error ? e.message : String(e));
					if (error.location.line === undefined) error.location = { line: token.line, column: token.column };
					throw error;
				}
			}
		} finally {
			// An error leaves the body's streams: the caller's is back.
			while (parser.tokenStreamStack.length > depth) parser.popTokenStream(false);
			unmute();
			restoreOptions();
			this.statementToken = caller.statement;
			this.lastGlobalLabel = caller.label;
			this.lastGlobalLabelLine = caller.labelLine;
		}

		if (!functionCall.result) throw new Error(`Function '${fn.name}' ends without .return.`);
		return functionCall.result.value;
	}

	/** One statement of a function's body: an assignment or one of `FUNCTION_DIRECTIVES`. */
	private runFunctionStatement(token: Token) {
		switch (token.type) {
			case "DOT": {
				const directive = this.parser.next() as ScalarToken;
				if (directive?.type !== "IDENTIFIER") throw new ParserError(`Expected a directive name after '.', got '${directive.value}'.`, directive);
				this.parser.checkDirectiveSpacing(token, directive);
				if (!this.parser.isKnownDirective(directive.value))
					throw new ParserError(`Syntax error - Unexpected directive '${directive.value}'`, directive);
				if (!FUNCTION_DIRECTIVES.has(directive.value)) throw AsmError.at(`.${directive.value} can't be in a function: ${FUNCTION_ONLY}.`, directive);
				this.runFunctionDirective(directive);
				return;
			}

			case "IDENTIFIER": {
				const name = token.raw ?? token.value;
				if (this.parser.isOperator("=")) {
					this.lastGlobalLabel = token.value;
					this.lastGlobalLabelLine = token.line;
					return;
				}
				if (this.parser.isDirective("EQU")) throw AsmError.at(`.EQU can't be in a function: ${FUNCTION_ONLY}.`, token);
				if (this.macroHandler.isMacro(token.value)) throw AsmError.at(`Macro '${name}' can't be called in a function: ${FUNCTION_ONLY}.`, token);
				if (this.cpuHandler.isInstruction(this.joinMnemonicSuffix(token as ScalarToken).value))
					throw AsmError.at(`Instruction '${name}' can't be in a function: ${FUNCTION_ONLY}.`, token);
				throw AsmError.at(`Label '${name}' can't be in a function: ${FUNCTION_ONLY}.`, token);
			}

			case "OPERATOR":
				if (token.value === "=" && this.lastGlobalLabel) {
					this.runFunctionDirective(token as ScalarToken);
					return;
				}
				if (token.value === "*") throw AsmError.at(`'*' can't be set in a function: ${FUNCTION_ONLY}.`, token);
				throw new ParserError(`Syntax error - Unexpected operator '${token.value}'`, token);

			// The braces of a block in the body: the block directive reads them.
			case "LBRACE":
			case "RBRACE":
				return;

			default:
				throw AsmError.at(`Label '${token.raw ?? token.value}' can't be in a function: ${FUNCTION_ONLY}.`, token);
		}
	}

	private runFunctionDirective(directive: ScalarToken) {
		const context: DirectiveContext = {
			filename: this.streamManager.currentFilepath,
			PC: this.PC,
			allowForwardRef: this.pass === 1,
			currentLabel: this.lastGlobalLabel,
			macroArgs: this.parser.tokenStreamStack.at(-1)?.macroArgs,
			emitbytes: () => {
				throw new Error(`Internal error: a function's body emitted bytes.`);
			},
		};
		if (this.pass === 1) {
			this.directiveHandler.handlePassOneDirective(directive, context);
			return;
		}
		const streamBefore = this.parser.tokenStreamStack.length;
		this.directiveHandler.handlePassTwoDirective(directive, context);
		// A new stream was pushed: it's read from its beginning.
		if (this.parser.tokenStreamStack.length > streamBefore) this.parser.setPosition(0);
	}

	/**
	 * Pass 2: a label must have the same address as in pass 1. If it moved, code before it changed size
	 * between the passes, and every forward reference to it was assembled with the pass-1 address.
	 */
	private checkLabelPhase(symbolName: string, description = `label '${symbolName}'`) {
		const value = this.symbolTable.lookupSymbol(symbolName);
		const pass1Value = value instanceof RelocValue ? value.offset : value;
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
		const { resolveValue, operands } = this.operandReaders(currentStream.macroArgs, true);
		const sizeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, resolveValue, operands);
		this.PC.value += sizeInfo.bytes;

		this.lister.bytes({
			addr: instructionPC,
			bytes: Array.from({ length: sizeInfo.bytes }, () => 0),
			text: this.lister.instruction(mnemonicToken, operandTokens),
			isCode: true,
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
			const { resolveValue, operands } = this.operandReaders(currentStream.macroArgs, false);
			const modeInfo = this.cpuHandler.resolveAddressingMode(mnemonicToken.value, operandTokens, resolveValue, operands);

			// 2. Encode Bytes using resolved info. Every symbol is known in pass 2, so is the operand.
			const { resolvedAddress } = modeInfo;
			if (resolvedAddress === null) throw new Error(`Internal error: the operand of '${mnemonicToken.value}' is still unknown in pass 2.`);
			const encodedBytes = this.cpuHandler.encodeInstruction([mnemonicToken, ...operandTokens], {
				...modeInfo,
				resolvedAddress,
				pc: this.PC.value,
			});

			// 3. LOGGING (New location)
			this.lister.bytes({
				addr: instructionPC,
				bytes: encodedBytes,
				text: this.lister.instruction(mnemonicToken, operandTokens),
				isCode: true,
			});

			this.linker.writeBytes(this.PC.value, encodedBytes);
			if (modeInfo.fixup) this.linker.addFixup(instructionPC + modeInfo.fixup.at, modeInfo.fixup.size, modeInfo.fixup.value);
			this.PC.value += encodedBytes.length;
		}
	}

	/**
	 * How the CPU reads an instruction's operands: `resolveValue` takes numbers only, `operands` relocatable values too,
	 * for a CPU that records their fixups.
	 */
	private operandReaders(macroArgs: Map<string, Token[]> | undefined, allowForwardRef: boolean) {
		const context = { PC: this.PC, allowForwardRef, currentLabel: this.lastGlobalLabel, macroArgs };
		const evaluate = (tokens: Token[]) => this.expressionEvaluator.evaluateOperand(tokens, context);
		const resolveValue = (tokens: Token[]) => {
			const value = evaluate(tokens);
			if (value instanceof RelocValue) throw noFixupError(value, this.cpuHandler.cpuType);
			return value;
		};
		const operands: OperandReader = { value: evaluate, branchTarget: (tokens) => this.branchTarget(evaluate(tokens)) };
		return { resolveValue, operands };
	}

	/** A branch's target, an address in the current segment whose distance is known: its offset in a relocatable one. */
	private branchTarget(target: number | RelocValue | null): number | null {
		const segment = this.linker.currentSegment;
		const from = segment ? `segment '${segment.name}'` : "outside any segment";
		if (target instanceof RelocValue) {
			if (segment?.relocatable && target.segment === segment.name && target.byteShift === undefined) return target.offset;
			throw new Error(`A branch from ${from} can't reach ${target}: the distance is only known when it's loaded.`);
		}
		if (target !== null && segment?.relocatable)
			throw new Error(`A branch from relocatable ${from} can't reach $${getHex(target)}: the distance is only known when it's loaded.`);
		return target;
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

/** The keys of a `SegmentDefinition` the assembler reads: any other is an attribute. */
const SEGMENT_DEFINITION_KEYS = ["name", "start", "size", "padValue", "resizable", "relocatable", "reloc"];

/** A segment definition's attributes: its other keys, in lowercase, each a number or a string. */
function segmentAttributes(seg: SegmentDefinition): SegmentAttributes {
	const attrs: SegmentAttributes = {};
	for (const [key, value] of Object.entries(seg)) {
		if (SEGMENT_DEFINITION_KEYS.includes(key)) continue;

		const name = key.toLowerCase();
		const known = SEGMENT_DEFINITION_KEYS.find((k) => k.toLowerCase() === name);
		if (known) throw new Error(`Segment '${seg.name}': '${key}' is written '${known}'.`);
		if (name in attrs) throw new Error(`Segment '${seg.name}' gives the attribute '${name}' twice.`);
		if (typeof value !== "number" && typeof value !== "string") throw new Error(`Segment '${seg.name}': attribute '${name}' must be a number or a string.`);
		attrs[name] = value;
	}
	return attrs;
}
