import { describe, expect, it } from "vitest";
import { DEFAULT_FORMAT, type FormatOptions, formatSource, sameTokens, statementTest } from "../../cli/format/format";
import { language } from "../../vscode/language";

const MNEMONICS = new Set(["LDA", "STA", "LDX", "DEX", "BNE", "BEQ", "RTS", "NOP", "JMP"]);
const SPACES: FormatOptions = { ...DEFAULT_FORMAT, tabSize: 4, insertSpaces: true };

/** `source` formatted, the 6502's mnemonics above and `macros` known. */
const format = (source: string, options: Partial<FormatOptions> = {}, macros: string[] = []) =>
	formatSource(source, { ...SPACES, ...options }, (word) => MNEMONICS.has(word) || macros.includes(word));

describe("VS Code formatting", () => {
	it("puts the labels, mnemonics, operands and comments in their columns", () => {
		expect(
			format(`
start: lda #$00 ; load 0
  sta $D020
exit:
rts
   ; a comment alone stays where it is
`),
		).toBe(`
start:  lda     #$00                    ; load 0
        sta     $D020
exit:
        rts
   ; a comment alone stays where it is
`);
	});

	it("uses tabs, the columns rounded up to a tab stop", () => {
		expect(format("start: lda #$00 ; load 0\n sta $D020", { insertSpaces: false })).toBe("start:\tlda\t\t#$00\t\t\t\t\t; load 0\n\t\tsta\t\t$D020");
		expect(format(" nop", { insertSpaces: false, tabSize: 3 })).toBe("\t\t\tnop");
	});

	it("pushes a field past a column to the next tab stop, never glued", () => {
		expect(
			format(`
verylonglabel: lda #0
x: .segment CODE
 jmp ($1234),y and a very long operand that goes past the comment column ; c
`),
		).toBe(`
verylonglabel:  lda #0
x:      .segment    CODE
        jmp     ($1234),y and a very long operand that goes past the comment column ; c
`);
		expect(format("verylonglabel: lda #0", { insertSpaces: false })).toBe("verylonglabel:\tlda\t#0");
	});

	it("keeps an operand as written, its strings and spaces", () => {
		expect(format(` lda ( $10 ),y`)).toBe(`        lda     ( $10 ),y`);
		expect(format(` .db "a  ;  b",   'c' ; d`)).toBe(`        .db     "a  ;  b",   'c'        ; d`);
		expect(format(` lda.w   $1000`)).toBe(`        lda.w   $1000`);
	});

	it("lays out an assignment as a label and a directive", () => {
		expect(
			format(`
HEIGHT = 5
WIDTH=40
* = $1000
screen .equ $0400
`),
		).toBe(`
HEIGHT  =       5
WIDTH=40
*       =       $1000
screen  .equ    $0400
`);
	});

	it("tells a label from a statement by the mnemonics and macros, else by where it's written", () => {
		const source = `
nop
exit
  clear
  fill $10
loop dex
`;
		expect(format(source)).toBe(`
        nop
exit
        clear
        fill    $10
loop    dex
`);
		expect(format(`clear $10`, {}, ["CLEAR"])).toBe(`        clear   $10`);
		expect(format(`clear $10`)).toBe(`clear   $10`);
		expect(format(`:loop dex\n: bne :-\n!x nop`)).toBe(`:loop   dex\n:       bne     :-\n!x      nop`);
	});

	it("indents a block's body, its labels staying at the line's start", () => {
		expect(
			format(`
.macro wait count
ldx #count
:loop dex
bne :loop
.if count > 2
nop
.else
.repeat 2 { nop }
.end
.end
`),
		).toBe(`
        .macro  wait count
            ldx     #count
:loop       dex
            bne     :loop
            .if     count > 2
                nop
            .else
                .repeat 2 { nop }
            .end
        .end
`);
	});

	it("indents a block in braces, its } and } .else { at its depth", () => {
		expect(
			format(`
.proc main {
.if 1 {
nop
} .else {
rts
}
}
`),
		).toBe(`
        .proc   main {
            .if     1 {
                nop
            } .else {
                rts
            }
        }
`);
	});

	it("doesn't indent a namespace's body, nor a block's when told not to", () => {
		expect(format(`.namespace gfx\nnop\n.end namespace`)).toBe(`        .namespace  gfx\n        nop\n        .end    namespace`);
		expect(format(`.repeat 2\nnop\n.end`, { indentBlocks: false })).toBe(`        .repeat 2\n        nop\n        .end`);
	});

	it("keeps a raw block's text and a block comment's lines as written", () => {
		const source = `
.define table as yaml
  - a:   1
  - b:   2
.end
.hex
 01 02   03
   .end
/* a block comment
  lda   #0
*/
lda #0 /* open
 still a comment */
.segment CODE {
  start:  $0800
}
`;
		expect(format(source)).toBe(`
        .define table as yaml
  - a:   1
  - b:   2
        .end
        .hex
 01 02   03
        .end
/* a block comment
  lda   #0
*/
        lda     #0                      /* open
 still a comment */
        .segment    CODE {
  start:  $0800
        }
`);
	});

	it("keeps a line starting with #, as a linker script's comment", () => {
		expect(format(`# a  comment\n.WORD 0 # previous`)).toBe(`# a  comment\n        .WORD   0 # previous`);
	});

	it("keeps a line ending in \\r\\n, and gives the same result formatted twice", () => {
		expect(format("start: lda #0\r\n rts\r\n")).toBe("start:  lda     #0\r\n        rts\r\n");
		const source = `
start: lda #0 ; c
.repeat 2 {
:x nop
}
`;
		const once = format(source);
		expect(format(once)).toBe(once);
	});

	it("checks the result has the source's tokens, and formats a source that doesn't lex", () => {
		expect(sameTokens(" lda  #0 ; c\n:  nop", "\tlda\t#0\t; d\n:\tnop")).toBe(true);
		expect(sameTokens(` .db "a  b"`, ` .db "a b"`)).toBe(false);
		expect(sameTokens(` lda #0`, ` lda#0`)).toBe(true);
		expect(sameTokens(`: nop`, `:nop`)).toBe(false);
		expect(format(` .db "a`)).toBe(`        .db     "a`);
	});

	it("knows the mnemonics of the CPU on each line, and the macros", () => {
		const source = `
lda #0
.cpu 6809 ; .cpu 6502
ldd #0
`;
		const lang = language();
		const in6502 = statementTest(source, lang, "6502", ["CLEAR"]);
		expect([in6502("LDA", 2), in6502("LDD", 2), in6502("LDD", 4), in6502("CLEAR", 2), in6502("START", 2)]).toEqual([true, false, true, true, false]);
		// In no project: every CPU's mnemonics up to a `.cpu`.
		const anywhere = statementTest(source, lang, undefined, []);
		expect([anywhere("LDD", 2), anywhere("ADDI", 2), anywhere("ADDI", 4)]).toEqual([true, true, false]);
	});
});
