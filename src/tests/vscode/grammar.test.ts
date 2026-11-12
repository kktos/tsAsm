import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import * as oniguruma from "vscode-oniguruma";
import { type IGrammar, INITIAL, Registry, parseRawGrammar } from "vscode-textmate";
import handlers from "../../cpu";
import { buildGrammar, buildLinkerGrammar } from "../../vscode/grammar";

let grammar: IGrammar;
let linkerGrammar: IGrammar;

beforeAll(async () => {
	const wasm = readFileSync(createRequire(import.meta.url).resolve("vscode-oniguruma/release/onig.wasm"));
	await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
	const registry = new Registry({
		onigLib: Promise.resolve({
			createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
			createOnigString: (text) => new oniguruma.OnigString(text),
		}),
		// VS Code has the YAML and JSON grammars a .define block embeds: empty ones here, as a rule embedding a missing one is dropped.
		loadGrammar: async (scopeName) => {
			const built = { "source.tsasm": buildGrammar, "source.tsasm.linker": buildLinkerGrammar }[scopeName];
			return parseRawGrammar(JSON.stringify(built ? built() : { scopeName, patterns: [] }), `${scopeName}.json`);
		},
	});
	grammar = (await registry.loadGrammar("source.tsasm")) as IGrammar;
	linkerGrammar = (await registry.loadGrammar("source.tsasm.linker")) as IGrammar;
});

/** The tokens of the source, each with its innermost scope. */
function tokenize(source: string, using = grammar) {
	let ruleStack = INITIAL;
	return source.split("\n").flatMap((line) => {
		const result = using.tokenizeLine(line, ruleStack);
		ruleStack = result.ruleStack;
		return result.tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scope: token.scopes.at(-1) }));
	});
}

/** The innermost scope of the `nth` token whose text, without its spaces, is `text`. */
function scopeOf(source: string, text: string, nth = 0, using = grammar) {
	const tokens = tokenize(source, using).filter((token) => token.text.trim() === text);
	if (!tokens[nth]) throw new Error(`No token '${text}' in: ${JSON.stringify(tokenize(source, using))}`);
	return tokens[nth].scope;
}

/** The same, in a linker script. */
const scriptScopeOf = (source: string, text: string) => scopeOf(source, text, 0, linkerGrammar);

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
		[".dw 1_000, $F_F, 0xF_F, %1_0, 0b1_0", "1_000", "constant.numeric.decimal.tsasm"],
		[".dw 1_000, $F_F, 0xF_F, %1_0, 0b1_0", "$F_F", "constant.numeric.hex.tsasm"],
		[".dw 1_000, $F_F, 0xF_F, %1_0, 0b1_0", "0xF_F", "constant.numeric.hex.tsasm"],
		[".dw 1_000, $F_F, 0xF_F, %1_0, 0b1_0", "%1_0", "constant.numeric.binary.tsasm"],
		[".dw 1_000, $F_F, 0xF_F, %1_0, 0b1_0", "0b1_0", "constant.numeric.binary.tsasm"],
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

	it.each(["$_FF", "0x_FF", "0b_1", "$FF_", "$F__F", "1000_", "1__000", "%1010_"])("doesn't colour %s as a number: a '_' goes between two digits", (number) => {
		const scopes = tokenize(`.dw ${number}`).map((token) => token.scope);
		expect(scopes.filter((scope) => scope?.startsWith("constant.numeric"))).toEqual([]);
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

describe("VS Code grammar of the linker scripts", () => {
	it.each([
		// `#` starts a comment; `;` doesn't
		["# 64-byte ROM", "# 64-byte ROM", "comment.line.number-sign.tsasm"],
		[".WRITE BYTE 0 AT 2    # overwrite", "# overwrite", "comment.line.number-sign.tsasm"],
		["// C style", "// C style", "comment.line.double-slash.tsasm"],
		[".byte $41 ; x", "; x", "source.tsasm.linker"],
		['.WRITE STRING "a # b"', "a # b", "string.quoted.double.tsasm"],
		// no instructions: a word starting a statement calls a macro
		["    lda #$00", "lda", "entity.name.function.macro.tsasm"],
		["    lda #$00", "#$00", "comment.line.number-sign.tsasm"],
		['OMF_FILE "main"', "OMF_FILE", "entity.name.function.macro.tsasm"],
		["    checkProdosName module.name", "checkProdosName", "entity.name.function.macro.tsasm"],
		["    OMF_FILE", "OMF_FILE", "entity.name.function.macro.tsasm"],
		// variables
		["romSize = 32 * 1024", "romSize", "variable.other.tsasm"],
		["romSize = 32 * 1024", "*", "keyword.operator.arithmetic.tsasm"],
		// .OUTPUT
		['.OUTPUT "game.rom" FIXED 64 PAD $FF', "OUTPUT", "keyword.control.directive.tsasm"],
		['.OUTPUT "game.rom" FIXED 64 PAD $FF', "game.rom", "string.quoted.double.tsasm"],
		['.OUTPUT "game.rom" FIXED 64 PAD $FF', "FIXED", "keyword.other.tsasm"],
		['.OUTPUT "game.rom" FIXED 64 PAD $FF', "PAD", "keyword.other.tsasm"],
		['.OUTPUT "game.rom" FIXED 64 PAD $FF', "$FF", "constant.numeric.hex.tsasm"],
		['.output "game.bin" max $8000', "max", "keyword.other.tsasm"],
		// .WRITE
		[".WRITE BYTE 0 AT 2", "WRITE", "keyword.control.directive.tsasm"],
		[".WRITE BYTE 0 AT 2", "BYTE", "storage.type.tsasm"],
		[".WRITE BYTE 0 AT 2", "AT", "keyword.other.tsasm"],
		['.WRITE SEGMENT "CODE"', "SEGMENT", "storage.type.tsasm"],
		['.WRITE MODULE("BOOT")', "MODULE", "storage.type.tsasm"],
		[".WRITE SEGMENT(s.name)", "name", "variable.other.property.tsasm"],
		[".write bytes [1, 2, 3]", "bytes", "storage.type.tsasm"],
		[".WRITE BYTE .lobyte(addr)", "lobyte", "support.function.builtin.tsasm"],
		// .SECTION, .ENDIAN
		[".SECTION HEADER AT $7FF0", "HEADER", "entity.name.type.section.tsasm"],
		[".SECTION HEADER AT $7FF0", "AT", "keyword.other.tsasm"],
		[".SECTION REST", "REST", "entity.name.type.section.tsasm"],
		[".ENDIAN BIG", "BIG", "constant.language.endian.tsasm"],
		// the other directives, system variables and functions
		['.include "omf.linker.asm"', "include", "keyword.control.directive.tsasm"],
		[".IF .PC > 64 - 6", "IF", "keyword.control.directive.tsasm"],
		[".IF .PC > 64 - 6", "PC", "variable.language.tsasm"],
		['.LOG "adding ", s.name', "LOG", "keyword.control.directive.tsasm"],
		[".FILL 64 - 6 - .PC, $FF", "FILL", "keyword.control.directive.tsasm"],
		['entry = .symbol("main")', "symbol", "support.function.builtin.tsasm"],
		// blocks
		[".macro OMF_SEGMENT seg, segnum, segEntry", "OMF_SEGMENT", "entity.name.function.macro.tsasm"],
		[".macro OMF_SEGMENT seg, segnum, segEntry", "segEntry", "variable.parameter.tsasm"],
		[".FOR seg OF .segments_list AS segnum FROM 1", "seg", "variable.parameter.tsasm"],
		[".FOR seg OF .segments_list AS segnum FROM 1", "OF", "keyword.other.tsasm"],
		[".FOR seg OF .segments_list AS segnum FROM 1", "segments_list", "variable.language.tsasm"],
		[".FOR seg OF .segments_list AS segnum FROM 1", "segnum", "variable.parameter.tsasm"],
	])("%s: '%s' is %s", (source, text, scope) => {
		expect(scriptScopeOf(source, text)).toBe(scope);
	});

	it("reads a script's statements in a block, and a block comment over several lines", () => {
		const source = `/* the code,
   then the rest */
.FOR s OF .UNWRITTEN_SEGMENTS
	.IF s.name != "VECTORS"
		.WRITE SEGMENT(s.name)
	.END
.END`;
		expect(scriptScopeOf(source, "then the rest")).toBe("comment.block.tsasm");
		expect(scriptScopeOf(source, "IF")).toBe("keyword.control.directive.tsasm");
		expect(scriptScopeOf(source, "SEGMENT")).toBe("storage.type.tsasm");
		expect(scriptScopeOf(source, "END")).toBe("keyword.control.directive.tsasm");
	});
});
