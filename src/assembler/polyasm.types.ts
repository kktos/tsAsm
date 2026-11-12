import type { DirectiveContext } from "../directives/directive.interface";
import type { Logger } from "../helpers/logger.class";
import type { Token } from "../shared/lexer/lexer.class";
import type { DefinitionSite, SourceLocation } from "../utils/error.utils";
import type { Options } from "./options";
import type { RelocValue } from "./reloc-value.class";
import type { SymbolValue } from "./symbol.class";

/** Defines the state of an active token stream. */
export interface StreamState {
	id: number;
	tokens: Token[];
	index: number;
	macroArgs?: Map<string, Token[]>;
	cacheName?: string;
	/** Set on the stream of an included file: its path. */
	file?: string;
	/** Set on the stream of a macro expansion: the macro's name. */
	macroName?: string;
	/** Set on the stream of a macro expansion: the token calling the macro. */
	macroCall?: Token;
	/** Set on the stream of a loop's iteration: where `.break` leaves. */
	loop?: boolean;
	/** Set on the stream of a block function's call: where `.return` leaves, and the value it gives. */
	functionCall?: FunctionCall;
}

/** A block function's call running: its name, and the value its `.return` gives, once it's run. */
export interface FunctionCall {
	name: string;
	result?: { value: SymbolValue };
}

export interface FileHandler {
	fullpath: string;
	filename: string;

	/** Reads raw source content and returns the string content for .INCLUDE. */
	readSourceFile(filename: string, from?: string): string;

	/** Reads raw file content and returns the byte array for .INCBIN. */
	readBinaryFile(filename: string, from?: string): number[];
}
/**
 * Defines a segment for the linker: a fixed one has a `start` and a `size`, a relocatable one no `start`, and grows without a `size`.
 * Any other key is an attribute, a number or a string, for the linker script (`seg.attrs.kind`).
 */
export interface SegmentDefinition {
	name: string;
	start?: number;
	size?: number;
	padValue?: number;
	resizable?: boolean;
	relocatable?: boolean;
	/** Short for `relocatable`. */
	reloc?: boolean;
	/** The size of its bank: 0 (no bank) or a power of two. */
	banksize?: number;
	[attribute: string]: string | number | boolean | undefined;
}

export type DataProcessor = (rawData: string, context: DirectiveContext) => SymbolValue;

export interface PushTokenStreamParams {
	newTokens: Token[];
	macroArgs?: Map<string, Token[]>;
	cacheName?: string;
	/** An included file's path: its tokens are cached, under the label syntax they are lexed with. */
	file?: string;
	macroName?: string;
	macroCall?: Token;
	loop?: boolean;
	functionCall?: FunctionCall;
	/** Called when the stream ends: `exited` when a `.exitmacro` or a `.break` left it before its end. */
	onEndOfStream?: (exited?: boolean) => void;
}

export interface AssemblerOptions {
	/** The name of the CPU the source starts with, among those given to the assembler (default: the first). */
	cpu?: string;
	segments?: SegmentDefinition[];
	logger?: Logger;
	log?: {
		pass1Enabled?: boolean;
		pass2Enabled?: boolean;
		/** Whether link() lists each segment's place in the binary. */
		linkerEnabled?: boolean;
	};
	rawDataProcessors?: { default: string; map: Map<string, DataProcessor> };
	/** Maximum number of nested macro expansions, to stop runaway recursion (default: 32). */
	maxMacroDepth?: number;
	/** The `.option` values each pass starts with, instead of their default: `{ "local.prefix": "@" }`. */
	options?: Options;
	/** `maxSize`: the largest output, with or without a linker script, 1 to $1000000 (16 MB). Default: $100000 (1 MB). */
	linker?: { maxSize?: number };
	/**
	 * Constants the source starts with, in the global namespace, as `.equ` defines them: `{ DISK_KB: 800 }`. A value
	 * is a number, a string, an array or an object; a boolean is 1 or 0. The source can't define them again.
	 */
	symbols?: Record<string, unknown>;
	/** Where each of `symbols` is defined, for messages and the symbol file: the project file, `command line`. */
	symbolSource?: (name: string) => string;
	/**
	 * Called for each name pass 2 resolves to what it names, as many times as it's assembled (a macro body at each
	 * call), then, once the assembly succeeded, for each symbol, macro and anonymous label defined (`definition`): what an
	 * editor needs to go to a definition. Without it, nothing is kept for it.
	 */
	onSymbolReference?: (reference: SymbolReference) => void;
	/**
	 * Pass 2 calls it for each statement that writes bytes, as an editor needs to show a line's address: where the
	 * statement is (located as an error is: in a macro body, its line in the macro's file, then the macro calls and the
	 * `.include` directives that led there), its address and its bytes. Without it, nothing is kept for it.
	 */
	onEmit?: (emission: Emission) => void;
	/**
	 * Pass 2 calls it for each line of the listing, as the CLI writes it with `log.pass2Enabled`, whatever the logger's
	 * settings: its text and the statement that listed it (located as `onEmit`'s), as an editor needs to show a line's
	 * listing. A loop folded by `.option listing.data = "fold"` is the line of its header. Without it, nothing is kept for it.
	 */
	onListing?: (line: ListedLine) => void;
	/**
	 * Pass 2 calls it for each statement it reads, where it starts (located as `onEmit`'s), as an editor needs to show
	 * the code not assembled: an `.if` branch not taken, a macro or a function never called. A statement in a loop or a
	 * macro body is told each time it's read, a function's body each time it runs. Without it, nothing is kept for it.
	 */
	onStatement?: (site: DefinitionSite) => void;
}

/** A line of the listing: see `AssemblerOptions.onListing`. */
export interface ListedLine {
	text: string;
	/** Undefined for a line listed before the first statement. */
	site?: DefinitionSite;
}

/** A statement's bytes: see `AssemblerOptions.onEmit`. */
export interface Emission {
	site: DefinitionSite;
	/** In a relocatable segment, its offset there (`CODE+$0012`). */
	address: number | RelocValue;
	bytes: number[];
}

/** What a name refers to: `kind` tells which. */
export interface SymbolInfo {
	/** As the assembler keeps it, in upper case: `START`, a local label `START.LOOP`, an anonymous label `:`. */
	name: string;
	/** Its namespace when it isn't the global one: `GFX`, or the scope the user can't name, `macro m`, `function f`. */
	namespace?: string;
	kind: "label" | "constant" | "variable" | "function" | "macro" | "anonymous label";
	/** A label's, a constant's or an anonymous label's value; a variable's where it's referred to, its last one for its definition. */
	value?: SymbolValue;
	/** A macro's or a function's parameters, as written: a macro's rest parameter is `...name`. */
	parameters?: string[];
	/** Where it's defined: in a macro body, its line in the macro's file, with the calls that led there. */
	site: DefinitionSite;
}

/** A name in the source, and what it refers to. */
export interface SymbolReference {
	/** Where the name is written: in a macro body, its line in the macro's file. */
	at: SourceLocation;
	/** Whether it's the definition itself, at `symbol.site`. */
	definition: boolean;
	symbol: SymbolInfo;
}
