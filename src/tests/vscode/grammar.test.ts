import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import * as oniguruma from "vscode-oniguruma";
import { type IGrammar, INITIAL, Registry, parseRawGrammar } from "vscode-textmate";
import handlers from "../../cpu";
import { buildGrammar } from "../../vscode/grammar";

let grammar: IGrammar;

beforeAll(async () => {
	const wasm = readFileSync(createRequire(import.meta.url).resolve("vscode-oniguruma/release/onig.wasm"));
	await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
	const registry = new Registry({
		onigLib: Promise.resolve({
			createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
			createOnigString: (text) => new oniguruma.OnigString(text),
		}),
		// VS Code has the YAML and JSON grammars a .define block embeds: empty ones here, as a rule embedding a missing one is dropped.
		loadGrammar: async (scopeName) =>
			parseRawGrammar(JSON.stringify(scopeName === "source.tsasm" ? buildGrammar() : { scopeName, patterns: [] }), `${scopeName}.json`),
	});
	grammar = (await registry.loadGrammar("source.tsasm")) as IGrammar;
});

/** The tokens of the source, each with its innermost scope. */
function tokenize(source: string) {
	let ruleStack = INITIAL;
	return source.split("\n").flatMap((line) => {
		const result = grammar.tokenizeLine(line, ruleStack);
		ruleStack = result.ruleStack;
		return result.tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scope: token.scopes.at(-1) }));
	});
}

/** The innermost scope of the `nth` token whose text, without its spaces, is `text`. */
function scopeOf(source: string, text: string, nth = 0) {
	const tokens = tokenize(source).filter((token) => token.text.trim() === text);
	if (!tokens[nth]) throw new Error(`No token '${text}' in: ${JSON.stringify(tokenize(source))}`);
	return tokens[nth].scope;
}

describe("VS Code grammar", () => {
	it("takes every mnemonic from the CPUs", () => {
		for (const Handler of Object.values(handlers)) {
			const cpu = new Handler();
			expect(cpu.mnemonics?.length, cpu.cpuType).toBeGreaterThan(0);
			for (const mnemonic of cpu.mnemonics ?? []) expect(cpu.isInstruction(mnemonic), `${cpu.cpuType} ${mnemonic}`).toBe(true);
		}
	});

	it.each([
		["start:  lda #$00    ; load 0", "start", "entity.name.function.label.tsasm"],
		["start:  lda #$00    ; load 0", "lda", "keyword.other.mnemonic.tsasm"],
		["start:  lda #$00    ; load 0", "#", "keyword.operator.immediate.tsasm"],
		["start:  lda #$00    ; load 0", "$00", "constant.numeric.hex.tsasm"],
		["start:  lda #$00    ; load 0", "; load 0", "comment.line.semicolon.tsasm"],
		["// C style", "// C style", "comment.line.double-slash.tsasm"],
		// a label without its colon, whatever its column
		["exit rts", "exit", "entity.name.function.label.tsasm"],
		["exit rts", "rts", "keyword.other.mnemonic.tsasm"],
		["exit", "exit", "entity.name.function.label.tsasm"],
		["nop", "nop", "keyword.other.mnemonic.tsasm"],
		["    LDA $1234", "LDA", "keyword.other.mnemonic.tsasm"],
		// every CPU's mnemonics
		["    ldd #1", "ldd", "keyword.other.mnemonic.tsasm"],
		["    addi x1, x0, 1", "addi", "keyword.other.mnemonic.tsasm"],
		["    jsl $123456", "jsl", "keyword.other.mnemonic.tsasm"],
		["    lda.b $12", "lda.b", "keyword.other.mnemonic.tsasm"],
		["    LDA.W $12", "LDA.W", "keyword.other.mnemonic.tsasm"],
		// a word that isn't an instruction: a macro call
		["    print welcome", "print", "entity.name.function.macro.tsasm"],
		["    print welcome", "welcome", "source.tsasm"],
		["loop: print welcome", "loop", "entity.name.function.label.tsasm"],
		["loop: print welcome", "print", "entity.name.function.macro.tsasm"],
		["    copy({#10}, $2001)", "copy", "entity.name.function.macro.tsasm"],
		["    copy {table,x}, $2000", "table", "source.tsasm"],
		// local and anonymous labels
		[":loop   dex", ":loop", "entity.name.function.label.local.tsasm"],
		[":loop   dex", "dex", "keyword.other.mnemonic.tsasm"],
		["        bne :loop", ":loop", "variable.other.label.local.tsasm"],
		[":   dex", ":", "entity.name.function.label.anonymous.tsasm"],
		[":   dex", "dex", "keyword.other.mnemonic.tsasm"],
		["    bne :-", ":-", "variable.other.label.anonymous.tsasm"],
		["    beq :++", ":++", "variable.other.label.anonymous.tsasm"],
		// directives, system functions and variables
		[".db $41", "db", "keyword.control.directive.tsasm"],
		[".db $41", ".", "punctuation.definition.directive.tsasm"],
		["table: .DW $1234", "table", "entity.name.function.label.tsasm"],
		["table: .DW $1234", "DW", "keyword.control.directive.tsasm"],
		[".native", "native", "keyword.control.directive.tsasm"],
		[".db .len(name)", "len", "support.function.builtin.tsasm"],
		[".db .pc", "pc", "variable.language.tsasm"],
		[".db ... .map(list, .lobyte)", "...", "keyword.operator.spread.tsasm"],
		[".db ... .map(list, .lobyte)", "map", "support.function.builtin.tsasm"],
		[".db ... .map(list, .lobyte)", "lobyte", "variable.language.tsasm"],
		["    lda #sprites[0].id", "id", "variable.other.property.tsasm"],
		[".db label.offset", "offset", "variable.other.property.tsasm"],
		[".log .segment.name", "segment", "variable.language.tsasm"],
		[".log .segment.name", "name", "variable.other.property.tsasm"],
		["    sta screen(10, 5)", "screen", "entity.name.function.tsasm"],
		["    lda #loader::count", "loader", "entity.name.namespace.tsasm"],
		// numbers
		[".db 170, $AA, 0xAA, %1010, 0b1010_1010", "170", "constant.numeric.decimal.tsasm"],
		[".db 170, $AA, 0xAA, %1010, 0b1010_1010", "0xAA", "constant.numeric.hex.tsasm"],
		[".db 170, $AA, 0xAA, %1010, 0b1010_1010", "%1010", "constant.numeric.binary.tsasm"],
		[".db 170, $AA, 0xAA, %1010, 0b1010_1010", "0b1010_1010", "constant.numeric.binary.tsasm"],
		[".db count % 10", "%", "keyword.operator.arithmetic.tsasm"],
		["    lda #%1010", "%1010", "constant.numeric.binary.tsasm"],
		// `*`: the PC, or a multiplication
		["    jmp * + 3", "*", "variable.language.pc.tsasm"],
		[".db count * 2", "*", "keyword.operator.arithmetic.tsasm"],
		["* = $1000", "*", "variable.language.pc.tsasm"],
		// strings
		['.text "Line1\\nLine2"', "\\n", "constant.character.escape.tsasm"],
		['.text "\\x41"', "\\x41", "constant.character.escape.tsasm"],
		[".text 'AB'", "AB", "string.quoted.single.tsasm"],
		['.text "a ; b"', "a ; b", "string.quoted.double.tsasm"],
		// constants and variables
		["HEIGHT .equ 25", "HEIGHT", "variable.other.constant.tsasm"],
		["HEIGHT .equ 25", "equ", "keyword.control.directive.tsasm"],
		["WIDTH = 40", "WIDTH", "variable.other.tsasm"],
		// blocks
		[".macro print str", "print", "entity.name.function.macro.tsasm"],
		[".macro print str", "str", "variable.parameter.tsasm"],
		[".macro struct id, ...fields", "fields", "variable.parameter.tsasm"],
		[".function screen(col, row) = $0400 + row*40 + col", "screen", "entity.name.function.tsasm"],
		[".function screen(col, row) = $0400 + row*40 + col", "col", "variable.parameter.tsasm"],
		[".fn sq(x) = x * x", "x", "variable.parameter.tsasm"],
		[".repeat 3 AS i FROM 0 {", "AS", "keyword.other.tsasm"],
		[".repeat 3 AS i FROM 0 {", "i", "variable.parameter.tsasm"],
		[".repeat 3 AS i FROM 0 {", "FROM", "keyword.other.tsasm"],
		[".for colour of colours AS idx", "colour", "variable.parameter.tsasm"],
		[".for colour of colours AS idx", "of", "keyword.other.tsasm"],
		[".for colour of colours AS idx", "idx", "variable.parameter.tsasm"],
		[".proc clearScreen", "clearScreen", "entity.name.function.tsasm"],
		[".namespace loader", "loader", "entity.name.namespace.tsasm"],
		[".end namespace", "end", "keyword.control.directive.tsasm"],
		[".segment BOOT { start: $0800, end: $08FF }", "BOOT", "entity.name.type.segment.tsasm"],
		[".segment BOOT { start: $0800, end: $08FF }", "start", "variable.other.property.tsasm"],
		['.option local.prefix "@"', "local.prefix", "variable.other.property.tsasm"],
		[".cpu 65C02", "65C02", "constant.language.cpu.tsasm"],
		// a statement after a brace
		[".if X { nop }", "nop", "keyword.other.mnemonic.tsasm"],
		["} .elseif (.len(name) == 0) {", "elseif", "keyword.control.directive.tsasm"],
		// .define
		['.define levels from "levels.yml"', "from", "keyword.other.tsasm"],
		[".define table AS JSON", "JSON", "support.type.data-processor.tsasm"],
	])("%s: '%s' is %s", (source, text, scope) => {
		expect(scopeOf(source, text)).toBe(scope);
	});

	it("reads a block comment over several lines", () => {
		expect(scopeOf("/* block comment,\n   lda #1 */\n    nop", "lda #1")).toBe("comment.block.tsasm");
		expect(scopeOf("/* block comment,\n   lda #1 */\n    nop", "nop")).toBe("keyword.other.mnemonic.tsasm");
	});

	it("reads a .hex block's digits up to its .end", () => {
		const source = ".hex\n    0E 60 0B 00 ; two\n.end\n    nop";
		expect(scopeOf(source, "0E")).toBe("constant.numeric.hex.tsasm");
		expect(scopeOf(source, "0B")).toBe("constant.numeric.hex.tsasm");
		expect(scopeOf(source, "; two")).toBe("comment.line.semicolon.tsasm");
		expect(scopeOf(source, "end")).toBe("keyword.control.directive.tsasm");
		expect(scopeOf(source, "nop")).toBe("keyword.other.mnemonic.tsasm");
		expect(scopeOf(".hex { 0E 60 }\n    nop", "0E")).toBe("constant.numeric.hex.tsasm");
		expect(scopeOf(".hex 0E 60\n    nop", "0E")).toBe("constant.numeric.hex.tsasm");
		expect(scopeOf(".hex 0E 60\n    nop", "nop")).toBe("keyword.other.mnemonic.tsasm");
	});

	it("reads a .define block as data up to its .end", () => {
		const source = ".define sprites\n    - { id: 0xAA, x: 0xA0 }\n.end\n    lda #sprites[0].id";
		expect(scopeOf(source, "sprites")).toBe("variable.other.tsasm");
		expect(scopeOf(source, "- { id: 0xAA, x: 0xA0 }")).toBe("meta.embedded.block.yaml");
		expect(scopeOf(source, "end")).toBe("keyword.control.directive.tsasm");
		expect(scopeOf(source, "lda")).toBe("keyword.other.mnemonic.tsasm");
		const json = ".define table AS JSON\n    [1, 2, 3]\n.end\n    nop";
		expect(scopeOf(json, "[1, 2, 3]")).toBe("meta.embedded.block.json");
		expect(scopeOf(json, "nop")).toBe("keyword.other.mnemonic.tsasm");
		const braces = ".define cfg { a: { b: 1 } }\n    nop";
		expect(scopeOf(braces, "nop")).toBe("keyword.other.mnemonic.tsasm");
	});
});
