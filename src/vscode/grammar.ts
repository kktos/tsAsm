/**
 * grammar.ts
 *
 * * The TextMate grammars of the VS Code extension (editors/vscode), built when it's bundled: the sources', whose
 *   mnemonics come from the CPUs, so an instruction is told from a macro call without a list to keep up to date, and
 *   the linker scripts' (`.linker.asm`), with their `#` comments and no labels nor instructions.
 */

import handlers from "../cpu";
import type { CPUHandler } from "../cpu/cpuhandler.interface";

type Captures = Record<string, { name?: string; patterns?: Rule[] }>;
type Rule = {
	name?: string;
	contentName?: string;
	match?: string;
	begin?: string;
	end?: string;
	captures?: Captures;
	beginCaptures?: Captures;
	endCaptures?: Captures;
	patterns?: Rule[];
	include?: string;
};

export type Grammar = {
	$schema: string;
	name: string;
	scopeName: string;
	patterns: Rule[];
	repository: Record<string, Rule>;
};

const ID = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
/** Where a statement starts: at the start of a line, or after a brace, as the parser reads them. */
const SOS = String.raw`(?:^|(?<=[{}]))[ \t]*`;
/** A label before the statement, `loop:`, `exit` then a space, `:loop`, or a lone `:`. Its text is re-read by #label-definition. */
const LABEL = String.raw`(?:(?:${ID}|[:@!?~]${ID})(?::[ \t]*|[ \t]+)|:[ \t]+)`;
/** The start of a statement, its label in group 1. */
const HEAD = `${SOS}(${LABEL})?`;
/** What can follow a word that ends: a space, the end of the line, a comment, a brace. */
const WORD_END = String.raw`(?=[ \t]|$|;|//|/\*|[{}])`;
/** The end of a directive's operands: the end of the line, a comment or a brace opening its block. */
const OPERANDS_END = String.raw`(?=$|;|//|/\*|[{}])`;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const anyOf = (words: Iterable<string>) => [...new Set(words)].sort().map(escape).join("|");

const directiveCaptures = (dot: number): Captures => ({
	[dot]: { name: "punctuation.definition.directive.tsasm" },
	[dot + 1]: { name: "keyword.control.directive.tsasm" },
});
const headCaptures = (captures: Captures = {}): Captures => ({ "1": { patterns: [{ include: "#label-definition" }] }, ...captures });

/** What an expression is made of: the same in a source and a linker script, but for the comments each grammar has. */
const EXPRESSION: Record<string, Rule> = {
	expression: {
		patterns: [
			{ include: "#comments" },
			{ include: "#strings" },
			{ include: "#numbers" },
			{ name: "keyword.operator.spread.tsasm", match: String.raw`\.\.\.` },
			{
				// `enemy = $0300 as Sprite`: the struct the value is an instance of, at the end of the line
				match: String.raw`\b((?i:as))[ \t]+(${ID}(?:::${ID})?)(?=[ \t]*(?:$|;|//|/\*))`,
				captures: { "1": { name: "keyword.other.tsasm" }, "2": { name: "entity.name.type.struct.tsasm" } },
			},
			{
				// A field, right after its operand: `sprites[0].id`, `label.offset`, `.segment.name`
				match: String.raw`(?<=[A-Za-z0-9_)\]])(\.)(${ID})`,
				captures: { "1": { name: "punctuation.accessor.tsasm" }, "2": { name: "variable.other.property.tsasm" } },
			},
			{
				// `.len("AB")`
				match: String.raw`(\.)(${ID})(?=\()`,
				captures: { "1": { name: "punctuation.definition.function.tsasm" }, "2": { name: "support.function.builtin.tsasm" } },
			},
			{
				// `.pc`, `.pass`
				match: String.raw`(\.)(${ID})`,
				captures: { "1": { name: "punctuation.definition.variable.tsasm" }, "2": { name: "variable.language.tsasm" } },
			},
			{
				match: String.raw`(${ID})(::)`,
				captures: { "1": { name: "entity.name.namespace.tsasm" }, "2": { name: "punctuation.separator.namespace.tsasm" } },
			},
			{ name: "entity.name.function.tsasm", match: String.raw`${ID}(?=\()` },
			{ name: "variable.other.label.anonymous.tsasm", match: String.raw`:(?:[-+][0-9]+|-+|\++)` },
			{ name: "variable.other.label.local.tsasm", match: String.raw`[:@]${ID}` },
			// After an operand, `*` multiplies and `%` is the modulo; elsewhere they're the PC (`jmp * + 3`) and a
			// binary number. The statement's head takes the spaces after it, so this can't start after a mnemonic.
			{ name: "keyword.operator.arithmetic.tsasm", match: String.raw`(?<=[A-Za-z0-9_)\]"'])[ \t]*[*%]` },
			{ name: "variable.language.pc.tsasm", match: String.raw`\*` },
			{ name: "keyword.operator.immediate.tsasm", match: "#" },
			{ name: "keyword.operator.tsasm", match: String.raw`<<|>>|<=|>=|==|!=|&&|\|\||[-+/%&|^!<>=]` },
			{ name: "punctuation.separator.comma.tsasm", match: "," },
			{ name: "punctuation.section.block.tsasm", match: "[{}]" },
			{ name: "punctuation.section.parens.tsasm", match: String.raw`[()\[\]]` },
		],
	},

	strings: {
		patterns: [
			{
				name: "string.quoted.double.tsasm",
				begin: '"',
				end: '"|$',
				patterns: [{ include: "#escapes" }],
			},
			{
				name: "string.quoted.single.tsasm",
				begin: "'",
				end: "'|$",
				patterns: [{ include: "#escapes" }],
			},
		],
	},
	escapes: {
		patterns: [
			{ name: "constant.character.escape.tsasm", match: String.raw`\\(?:[nrtbf'"\\]|x[0-9A-Fa-f]{2})` },
			{ name: "invalid.illegal.escape.tsasm", match: String.raw`\\.` },
		],
	},

	numbers: {
		// A '_' groups digits: only between two of them, as the lexer reads it.
		patterns: [
			{ name: "constant.numeric.hex.tsasm", match: String.raw`\$[0-9A-Fa-f]+(?:_[0-9A-Fa-f]+)*\b` },
			{ name: "constant.numeric.hex.tsasm", match: String.raw`\b0[xX][0-9A-Fa-f]+(?:_[0-9A-Fa-f]+)*\b` },
			{ name: "constant.numeric.binary.tsasm", match: String.raw`\b0[bB][01]+(?:_[01]+)*\b` },
			{ name: "constant.numeric.binary.tsasm", match: String.raw`(?<![A-Za-z0-9_)\]"'])%[01]+(?:_[01]+)*\b` },
			{ name: "constant.numeric.decimal.tsasm", match: String.raw`\b[0-9]+(?:_[0-9]+)*\b` },
		],
	},
};

/** Where a statement starts, its label in group 1, and the captures of that label. */
type Head = { pattern: string; captures: (captures?: Captures) => Captures };
const SOURCE_HEAD: Head = { pattern: HEAD, captures: headCaptures };

/** `.macro print str`, `.macro print(str) {`, `.macro struct id, ...fields` */
function macroHeader(head: Head, operandsEnd: string): Rule {
	return {
		begin: String.raw`${head.pattern}(\.)((?i:macro))[ \t]+(${ID})`,
		beginCaptures: head.captures({ ...directiveCaptures(2), "4": { name: "entity.name.function.macro.tsasm" } }),
		end: operandsEnd,
		patterns: [
			{ name: "keyword.operator.spread.tsasm", match: String.raw`\.\.\.` },
			{ name: "variable.parameter.tsasm", match: ID },
			{ name: "punctuation.separator.comma.tsasm", match: "," },
			{ name: "punctuation.section.parens.tsasm", match: "[()]" },
		],
	};
}

/** `.repeat 3 AS i FROM 0`, `.for colour of colours AS idx` */
function loopHeader(head: Head, wordEnd: string, operandsEnd: string): Rule {
	return {
		begin: String.raw`${head.pattern}(\.)((?i:repeat|for))${wordEnd}`,
		beginCaptures: head.captures(directiveCaptures(2)),
		end: operandsEnd,
		patterns: [
			{
				match: String.raw`\G[ \t]+(${ID})(?=[ \t]+(?i:of)\b)`,
				captures: { "1": { name: "variable.parameter.tsasm" } },
			},
			{
				match: String.raw`\b((?i:as))[ \t]+(${ID})`,
				captures: { "1": { name: "keyword.other.tsasm" }, "2": { name: "variable.parameter.tsasm" } },
			},
			{ name: "keyword.other.tsasm", match: String.raw`\b(?i:of|from)\b` },
			{ include: "#expression" },
		],
	};
}

/** The grammar, for the CPUs given: the CLI's by default. */
export function buildGrammar(cpus: readonly CPUHandler[] = Object.values(handlers).map((Handler) => new Handler())): Grammar {
	const mnemonics = anyOf(cpus.flatMap((cpu) => cpu.mnemonics ?? []));
	const suffixes = anyOf(cpus.flatMap((cpu) => cpu.mnemonicSuffixes ?? []));
	const suffix = suffixes ? `(?:\\.(?i:${suffixes}))?` : "";

	return {
		$schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
		name: "tsAsm",
		scopeName: "source.tsasm",
		patterns: [{ include: "#comments" }, { include: "#statements" }, { include: "#expression" }],
		repository: {
			comments: {
				patterns: [
					{
						name: "comment.block.tsasm",
						begin: String.raw`/\*`,
						end: String.raw`\*/`,
						beginCaptures: { "0": { name: "punctuation.definition.comment.tsasm" } },
						endCaptures: { "0": { name: "punctuation.definition.comment.tsasm" } },
					},
					{ name: "comment.line.semicolon.tsasm", match: ";.*$" },
					{ name: "comment.line.double-slash.tsasm", match: "//.*$" },
				],
			},

			// What starts a statement. The first rule matching wins: an instruction before a macro call.
			statements: {
				patterns: [
					{ include: "#hex-block" },
					{ include: "#define-block" },
					{ include: "#macro-header" },
					{ include: "#function-header" },
					{ include: "#loop-header" },
					{ include: "#named-block" },
					{ include: "#segment-header" },
					{ include: "#reserve" },
					{ include: "#option" },
					{ include: "#cpu" },
					{
						// `HEIGHT .equ 25`: a constant
						match: String.raw`${SOS}(${ID})[ \t]+(\.)((?i:equ))${WORD_END}`,
						captures: { "1": { name: "variable.other.constant.tsasm" }, ...directiveCaptures(2) },
					},
					{
						name: "meta.instruction.tsasm",
						// `lda.b`: the suffix is part of the mnemonic's word
						match: String.raw`${HEAD}((?i:${mnemonics})${suffix})${WORD_END}[ \t]*`,
						captures: headCaptures({ "2": { name: "keyword.other.mnemonic.tsasm" } }),
					},
					{
						match: String.raw`${HEAD}(\.)(${ID})${WORD_END}[ \t]*`,
						captures: headCaptures(directiveCaptures(2)),
					},
					{
						// `* = $1000`
						match: String.raw`${SOS}(\*)(?=[ \t]*=)`,
						captures: { "1": { name: "variable.language.pc.tsasm" } },
					},
					{
						// `count = 1`
						match: String.raw`${SOS}(${ID})(?=[ \t]*=(?!=))`,
						captures: { "1": { name: "variable.other.tsasm" } },
					},
					{
						// A word that isn't an instruction, followed by its arguments: `print welcome`, `copy({#10}, $2001)`
						match: String.raw`${HEAD}(${ID})(?=\(|[ \t]+[^ \t;/])[ \t]*`,
						captures: headCaptures({ "2": { name: "entity.name.function.macro.tsasm" } }),
					},
					{
						// A label alone: `loop:`, `exit`, `:loop`, `:`
						match: String.raw`${SOS}((?:${ID}|[:@!?~]${ID}):?|:)(?=[ \t]*(?:$|;|//|/\*|\}))`,
						captures: headCaptures(),
					},
				],
			},

			"label-definition": {
				patterns: [
					{ name: "entity.name.function.label.local.tsasm", match: String.raw`[:@!?~]${ID}` },
					{ name: "entity.name.function.label.tsasm", match: ID },
					{ name: "entity.name.function.label.anonymous.tsasm", match: String.raw`(?<![A-Za-z0-9_]):(?=[ \t]|$)` },
					{ name: "punctuation.separator.label.tsasm", match: ":" },
				],
			},

			"macro-header": macroHeader(SOURCE_HEAD, OPERANDS_END),

			// `.function screen(col, row) = $0400 + row*40 + col`, `.fn sq(x) {`
			"function-header": {
				begin: String.raw`${HEAD}(\.)((?i:function|fn))[ \t]+(${ID})`,
				beginCaptures: headCaptures({ ...directiveCaptures(2), "4": { name: "entity.name.function.tsasm" } }),
				end: OPERANDS_END,
				patterns: [
					{
						begin: String.raw`\G\(`,
						end: String.raw`\)`,
						beginCaptures: { "0": { name: "punctuation.section.parens.tsasm" } },
						endCaptures: { "0": { name: "punctuation.section.parens.tsasm" } },
						patterns: [
							{ name: "variable.parameter.tsasm", match: ID },
							{ name: "punctuation.separator.comma.tsasm", match: "," },
						],
					},
					{ include: "#expression" },
				],
			},

			"loop-header": loopHeader(SOURCE_HEAD, WORD_END, OPERANDS_END),

			// `.proc clearScreen`, `.namespace loader`, `.module GAME`, `.struct Sprite`
			"named-block": {
				patterns: [
					namedDirective("proc|procedure", "entity.name.function.tsasm"),
					namedDirective("struct", "entity.name.type.struct.tsasm"),
					namedDirective("namespace", "entity.name.namespace.tsasm"),
					namedDirective("module", "entity.name.type.module.tsasm"),
				],
			},

			// `.segment CODE { start: $0800, end: $08FF }`: its keys aren't labels
			"segment-header": {
				begin: String.raw`${HEAD}(\.)((?i:segment))[ \t]+(${ID})`,
				beginCaptures: headCaptures({ ...directiveCaptures(2), "4": { name: "entity.name.type.segment.tsasm" } }),
				end: "$",
				patterns: [
					{ include: "#comments" },
					{
						match: String.raw`(${ID})[ \t]*(:)`,
						captures: { "1": { name: "variable.other.property.tsasm" }, "2": { name: "punctuation.separator.key-value.tsasm" } },
					},
					{ include: "#expression" },
				],
			},

			// `player: .res Sprite { x: 10, name: "HERO" }`: its fields' names aren't labels
			reserve: {
				begin: String.raw`${HEAD}(\.)((?i:res|ds|fill))${WORD_END}`,
				beginCaptures: headCaptures(directiveCaptures(2)),
				end: "$",
				patterns: [
					{ include: "#comments" },
					{
						// `gfx::Sprite` isn't a field
						match: String.raw`(?<!:)(${ID})[ \t]*(:)(?!:)`,
						captures: { "1": { name: "variable.other.property.tsasm" }, "2": { name: "punctuation.separator.key-value.tsasm" } },
					},
					{ include: "#expression" },
				],
			},

			// `.option local.prefix "@"`
			option: {
				match: String.raw`${HEAD}(\.)((?i:option))[ \t]+(${ID}(?:\.${ID})*)`,
				captures: headCaptures({ ...directiveCaptures(2), "4": { name: "variable.other.property.tsasm" } }),
			},

			// `.cpu 65C02`: a word alone is the CPU's name; anything else is an expression
			cpu: {
				match: String.raw`${HEAD}(\.)((?i:cpu|setcpu|processor))[ \t]+([A-Za-z0-9_]+)(?=[ \t]*(?:$|;|//|/\*))`,
				captures: headCaptures({ ...directiveCaptures(2), "4": { name: "constant.language.cpu.tsasm" } }),
			},

			// `.hex 0E 60`, `.hex { 0E 60 }`, or its digits up to `.end`
			"hex-block": {
				patterns: [
					{
						begin: String.raw`${HEAD}(\.)((?i:hex))[ \t]*(\{)`,
						beginCaptures: headCaptures({ ...directiveCaptures(2), "4": { name: "punctuation.section.block.tsasm" } }),
						end: String.raw`\}`,
						endCaptures: { "0": { name: "punctuation.section.block.tsasm" } },
						patterns: [{ include: "#hex-digits" }],
					},
					{
						begin: String.raw`${HEAD}(\.)((?i:hex))(?=[ \t]*(?:$|;|//|/\*))`,
						beginCaptures: headCaptures(directiveCaptures(2)),
						end: String.raw`^[ \t]*(\.)((?i:end))\b`,
						endCaptures: directiveCaptures(1),
						patterns: [{ include: "#hex-digits" }],
					},
					{
						begin: String.raw`${HEAD}(\.)((?i:hex))[ \t]+`,
						beginCaptures: headCaptures(directiveCaptures(2)),
						end: "$",
						patterns: [{ include: "#hex-digits" }],
					},
				],
			},
			"hex-digits": { patterns: [{ include: "#comments" }, { name: "constant.numeric.hex.tsasm", match: "[0-9A-Fa-f]+" }] },

			// `.define levels from "levels.yml"`, or a block of YAML (the default), JSON or TEXT
			"define-block": {
				patterns: [
					{
						begin: String.raw`${HEAD}(\.)((?i:define))[ \t]+(${ID})(?=.*\b(?i:from)\b)`,
						beginCaptures: headCaptures({ ...directiveCaptures(2), "4": { name: "variable.other.tsasm" } }),
						end: OPERANDS_END,
						patterns: [{ include: "#define-keywords" }, { include: "#expression" }],
					},
					defineBlock("JSON", "source.json", "json"),
					defineBlock("TEXT"),
					defineBlock("YAML", "source.yaml", "yaml"),
				],
			},
			"define-keywords": {
				patterns: [
					{
						match: String.raw`\b((?i:as))[ \t]+(${ID})`,
						captures: { "1": { name: "keyword.other.tsasm" }, "2": { name: "support.type.data-processor.tsasm" } },
					},
					{ name: "keyword.other.tsasm", match: String.raw`\b(?i:from)\b` },
				],
			},
			"nested-braces": {
				begin: String.raw`\{`,
				end: String.raw`\}`,
				patterns: [{ include: "#nested-braces" }],
			},

			...EXPRESSION,
		},
	};
}

/** A directive whose name follows it: `.proc clearScreen`. */
function namedDirective(directives: string, scope: string): Rule {
	return {
		match: String.raw`${HEAD}(\.)((?i:${directives}))[ \t]+(${ID})${WORD_END}`,
		captures: headCaptures({ ...directiveCaptures(2), "4": { name: scope } }),
	};
}

/** A `.define` block up to its `.end` or its `}`, its text read as `language` when there's a grammar for it. */
function defineBlock(processor: string, include?: string, language?: string): Rule {
	const as = processor === "YAML" ? String.raw`(?:[ \t]+((?i:as))[ \t]+((?i:yaml)))?` : String.raw`[ \t]+((?i:as))[ \t]+((?i:${processor}))`;
	const captures = {
		"4": { name: "variable.other.tsasm" },
		"5": { name: "keyword.other.tsasm" },
		"6": { name: "support.type.data-processor.tsasm" },
	};
	const contentName = language ? `meta.embedded.block.${language}` : "string.unquoted.text.tsasm";
	const patterns = include ? [{ include }] : [];
	return {
		patterns: [
			{
				begin: String.raw`${HEAD}(\.)((?i:define))[ \t]+(${ID})${as}[ \t]*(\{)`,
				beginCaptures: headCaptures({ ...directiveCaptures(2), ...captures, "7": { name: "punctuation.section.block.tsasm" } }),
				end: String.raw`\}`,
				endCaptures: { "0": { name: "punctuation.section.block.tsasm" } },
				contentName,
				patterns: [{ include: "#nested-braces" }, ...patterns],
			},
			{
				begin: String.raw`${HEAD}(\.)((?i:define))[ \t]+(${ID})${as}(?=[ \t]*(?:$|;|//|/\*))`,
				beginCaptures: headCaptures({ ...directiveCaptures(2), ...captures }),
				end: String.raw`^[ \t]*(\.)((?i:end))\b`,
				endCaptures: directiveCaptures(1),
				contentName,
				patterns,
			},
		],
	};
}

/** A linker script's statement starts as a source's, without a label: the empty group keeps the captures' numbers. */
const LINKER_HEAD: Head = { pattern: `${SOS}()`, captures: (captures = {}) => captures };
/** In a linker script, `#` starts a comment, not `;`. A `.WRITE`'s type can be followed by its value in parentheses. */
const LINKER_WORD_END = String.raw`(?=[ \t]|$|#|//|/\*|[{}(])`;
const LINKER_OPERANDS_END = String.raw`(?=$|#|//|/\*|[{}])`;

/**
 * The grammar of the linker scripts, `.linker.asm` (src/linker/linker_script.md): directives, variables and macro
 * calls, the source's expressions, `#` comments; no labels, no instructions.
 */
export function buildLinkerGrammar(): Grammar {
	return {
		$schema: "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
		name: "tsAsm linker script",
		scopeName: "source.tsasm.linker",
		patterns: [{ include: "#comments" }, { include: "#statements" }, { include: "#expression" }],
		repository: {
			comments: {
				patterns: [
					{
						name: "comment.block.tsasm",
						begin: String.raw`/\*`,
						end: String.raw`\*/`,
						beginCaptures: { "0": { name: "punctuation.definition.comment.tsasm" } },
						endCaptures: { "0": { name: "punctuation.definition.comment.tsasm" } },
					},
					{ name: "comment.line.number-sign.tsasm", match: "#.*$" },
					{ name: "comment.line.double-slash.tsasm", match: "//.*$" },
				],
			},

			statements: {
				patterns: [
					{ include: "#macro-header" },
					{ include: "#loop-header" },
					{ include: "#output" },
					{ include: "#write" },
					{ include: "#section" },
					{ include: "#endian" },
					{
						match: String.raw`${LINKER_HEAD.pattern}(\.)(${ID})${LINKER_WORD_END}[ \t]*`,
						captures: directiveCaptures(2),
					},
					{
						// `romSize = 32 * 1024`
						match: String.raw`${SOS}(${ID})(?=[ \t]*=(?!=))`,
						captures: { "1": { name: "variable.other.tsasm" } },
					},
					{
						// Any other word starting a statement calls a macro: `OMF_FILE "main"`
						match: String.raw`${SOS}(${ID})${LINKER_WORD_END}`,
						captures: { "1": { name: "entity.name.function.macro.tsasm" } },
					},
				],
			},

			"macro-header": macroHeader(LINKER_HEAD, LINKER_OPERANDS_END),
			"loop-header": loopHeader(LINKER_HEAD, LINKER_WORD_END, LINKER_OPERANDS_END),

			// `.OUTPUT "game.rom" FIXED 64 PAD $FF`, `.OUTPUT "game.bin" MAX $8000`
			output: linkerDirective("output", String.raw`\b(?i:fixed|pad|max)\b`),

			// `.WRITE SEGMENT "CODE"`, `.WRITE MODULE(m.name)`, `.WRITE BYTE 0 AT 2`
			write: {
				begin: String.raw`${LINKER_HEAD.pattern}(\.)((?i:write))[ \t]+((?i:segment|module|bytes|byte|word|long|string))${LINKER_WORD_END}`,
				beginCaptures: { ...directiveCaptures(2), "4": { name: "storage.type.tsasm" } },
				end: LINKER_OPERANDS_END,
				patterns: [{ name: "keyword.other.tsasm", match: String.raw`\b(?i:at)\b` }, { include: "#expression" }],
			},

			// `.SECTION HEADER AT $7FF0`
			section: {
				begin: String.raw`${LINKER_HEAD.pattern}(\.)((?i:section))[ \t]+(${ID})`,
				beginCaptures: { ...directiveCaptures(2), "4": { name: "entity.name.type.section.tsasm" } },
				end: LINKER_OPERANDS_END,
				patterns: [{ name: "keyword.other.tsasm", match: String.raw`\b(?i:at)\b` }, { include: "#expression" }],
			},

			// `.ENDIAN BIG`
			endian: {
				match: String.raw`${LINKER_HEAD.pattern}(\.)((?i:endian))[ \t]+((?i:big|little))${LINKER_WORD_END}`,
				captures: { ...directiveCaptures(2), "4": { name: "constant.language.endian.tsasm" } },
			},

			...EXPRESSION,
		},
	};
}

/** A linker directive whose operands are an expression and the keywords given. */
function linkerDirective(directive: string, keywords: string): Rule {
	return {
		begin: String.raw`${LINKER_HEAD.pattern}(\.)((?i:${directive}))${LINKER_WORD_END}`,
		beginCaptures: directiveCaptures(2),
		end: LINKER_OPERANDS_END,
		patterns: [{ name: "keyword.other.tsasm", match: keywords }, { include: "#expression" }],
	};
}
