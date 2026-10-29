import type { DirectiveContext } from "../directives/directive.interface";
import type { Logger } from "../helpers/logger.class";
import type { Token } from "../shared/lexer/lexer.class";
import type { Options } from "./options";
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
}
