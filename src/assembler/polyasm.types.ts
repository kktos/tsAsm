import type { DirectiveContext } from "../directives/directive.interface";
import type { Logger } from "../helpers/logger.class";
import type { Token } from "../shared/lexer/lexer.class";
import type { SymbolValue } from "./symbol.class";

/** Defines the state of an active token stream. */
export interface StreamState {
	id: number;
	tokens: Token[];
	index: number;
	macroArgs?: Map<string, Token[]>;
	cacheName?: string;
	/** Set on the stream of a macro expansion: the macro's name. */
	macroName?: string;
	/** Set on the stream of a macro expansion: the token calling the macro. */
	macroCall?: Token;
}

export interface FileHandler {
	fullpath: string;
	filename: string;

	/** Reads raw source content and returns the string content for .INCLUDE. */
	readSourceFile(filename: string, from?: string): string;

	/** Reads raw file content and returns the byte array for .INCBIN. */
	readBinaryFile(filename: string, from?: string): number[];
}
/** Defines a segment for the linker. */

export interface SegmentDefinition {
	name: string;
	start: number;
	size: number;
	padValue?: number;
	resizable?: boolean;
}

export type DataProcessor = (rawData: string, context: DirectiveContext) => SymbolValue;

export interface PushTokenStreamParams {
	newTokens: Token[];
	macroArgs?: Map<string, Token[]>;
	cacheName?: string;
	macroName?: string;
	macroCall?: Token;
	onEndOfStream?: () => void;
}

export interface AssemblerOptions {
	segments?: SegmentDefinition[];
	logger?: Logger;
	log?: {
		pass1Enabled?: boolean;
		pass2Enabled?: boolean;
	};
	rawDataProcessors?: { default: string; map: Map<string, DataProcessor> };
	/** Maximum number of nested macro expansions, to stop runaway recursion (default: 32). */
	maxMacroDepth?: number;
}
