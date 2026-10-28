# tsAsm — changelog

What was fixed or added since the code review (`tsAsm-code-review.md`), by PR, newest first.
Each entry keeps its number from `TODO.md`, where it was tracked (1.1, 2.5 #9…): the entries and the TODO refer to each other by these numbers.
The problem is described as it was before the fix, then the fix in _italics_.

## Assembler

### #170 — `.repeat`'s header not listed (TODO 1.60)

The listing showed `.for x of list` before the loop's lines, but nothing for a `.repeat`: its lines came without a word. With `listing.data "fold"`, only a folded `.repeat` showed its header. `.repeat 0` listed nothing, where an empty `.for` lists its header.

_Decided: a `.repeat` is listed as a `.for` is, its header (`.repeat $02 AS i`) before its lines, also when it repeats 0 times._

### #169 — Anonymous and local labels not listed (TODO 1.59)

`:` / `nop` / `bne :-` listed the `NOP` and the `BNE :-`, but not the `:`, where a named label gets its own line (`1000 start:`). Same for a local label: `:loop` / `dex` / `bne :loop` listed no `:loop`.

_They get their line, as written: `1000 :`, `1003 :loop`._

### #163 — `.cpu` with a symbol defined after it (TODO 1.56)

`.cpu .iif(C02, "65C02", "6502")` / `C02 = 1` → `.CPU name must evaluate to a string.`: in pass 1, `C02` isn't defined yet. It's an error, the CPU is needed from pass 1 on, but the message didn't say why.

_As `.repeat`, `.for` and `.str` do: `.CPU: 'C02' must be defined before it is used here (the CPU is needed to read what follows).` Same for `.cpu (TARGET)` and a symbol never defined._

### #162 — Pass 2 started with the CPU pass 1 ended with (TODO 1.57)

`input.cpu: 65C02` (or `new Assembler(new Cpu65C02Handler(), …)`) and `stz $44` / `.cpu 6502` / `nop` → `EA`: the `STZ` was lost, silently. Pass 2 started with the 6502, where pass 1 ended, so `stz` was read as a label and the `$44` after it dropped. Only `assemble()` went back to the initial CPU, between two calls.

_Each pass starts with the initial CPU, as it does with the options: `64 44 EA`._

### #159 — `.cpu` needs quotes (TODO 3.8)

`.cpu "65C02"` needed quotes, `.segment BOOT` and `.module GAME` didn't. `.cpu 65C02` → `Invalid number '65C02'.`, from the lexer, even in a `.if 0`; `.cpu 6502` and `.cpu rv32i` → `.CPU name must evaluate to a string.` The name was an expression, for a CPU chosen by a symbol.

_Decided: as `.segment`, a word alone is the CPU's name, in any case: `.cpu 65C02`, `.cpu 6502`, `.cpu rv32i`. A word starting with a digit is read as raw text, as `.hex` does, so it isn't lexed as a number. Anything else is a string expression: `.cpu "65C02"`, `.cpu (TARGET)`. Breaking: `.cpu TARGET`, with `TARGET = "65C02"`, is now `Unknown CPU name 'TARGET'.`; write `.cpu (TARGET)`, or use `.iif()`: `.cpu .iif(C02, "65C02", "6502")`._

### #158 — A symbol located at its directive, not at its name (TODO 1.55)

`SCREEN .equ $0400` was located at the `.equ` (`:1:8`), `counter = 1` at the `=` (`:1:9`), `.let total = 0`, `.define sprites` and `.proc clear` at their directive, a loop's iterator at its loop: in the `.sym` file and in the notes of `Symbol 'X' redefined.` / `Can't redefine constant 'X'.`. A label was located at its name. The name before `.equ` and `=` is a statement of its own, so the directive starts the next one.

_Every symbol is located at its name: `SCREEN: const number = $0400 ;t.asm:1:1`, `.let X = 1` noted at the `X`, `.proc f` at the `f`, `.repeat 2 AS i` at the `i`. The errors stay at their statement, and a macro at its `.macro`. The linker's `=` is unchanged: it only has the name as text, and its symbols aren't in the `.sym` file._

### #154 — a variable's redefinition pointed at its last assignment as its first definition (TODO 1.52)

`v = 1` / `v = 2` / `v .equ 3` → `Symbol 'V' redefined.`, with the note `first defined here` at `v = 2`: each assignment moves where the variable is defined.

_Decided: the note says `last assigned here` when the variable was assigned more than once; a symbol given one value still says `first defined here`._

### #153 — `=` and `.equ` documented as the same; a variable used before it's assigned (TODO 3.3)

REFERENCE said `=` and `.equ` are the same, but `=` can be reassigned and `.equ` can't (`Symbol 'X' redefined.`). A variable used before it's assigned took its last value in pass 1: `.db v` / `v = 1` / `v = 2` → `02`, and `.db v` / `v = 0` / `.repeat 3 {` / `v = v + 1` / `}` → `03`.

_Decided: `=` and `.let` assign a variable, `.equ` and labels define a constant, as before; REFERENCE says so. A variable used before it's assigned, when it's assigned more than once, is an error at the use: `Variable 'V' is used before it's assigned, and it's assigned more than once: its value here is ambiguous.` A variable assigned once, or a constant, can still be used before it's defined._

### #152 — `.fill` listed at its end address (TODO 1.49)

`.org $1000` / `nop` / `.db 1` / `.fill 4, 2` / `nop` listed `1006: 02 02 02 02  .fill $04, $02`: the address where the fill ends, not where it starts (`$1002`). The bytes were written at the right place; only the listing was wrong. Same in a loop: `.repeat 4 AS r FROM 0` / `.fill 16, $E9 + r` at `$1080` listed its first line at `$1090`.

_`.fill` takes the address before emitting its bytes, as `.align` does: `1002: 02 02 02 02`, and the loop's first line at `$1080`._

### #151 — `.repeat` counts from 1, `.for` from 0; text after a loop's iterator ignored (TODO 3.2, 1.48)

`.repeat 3 AS i` gave 1, 2, 3, `.for … AS idx` 0, 1, 2, with no way to choose: `.dw base + i*8` is off by one, and ca65's `.repeat` counts from 0. Anything after `AS <iterator>` was ignored: `.repeat 3 AS i junk` and `.repeat 3 AS i FROM 0` gave `01 02 03`, `.repeat 3 AS` and `.repeat 3 AS 5` assembled.

_Decided: the defaults stay, and the start can be chosen. Locally: `.repeat 3 AS i FROM 0`, `.for c of a AS idx FROM 1` (any whole number, negative too, symbols defined before the loop; the `.for` items still start at the first). For a file or the project: the options `repeat.start` and `for.start`, `0` or `1`, by `.option` or the project file's `input.options`; `FROM` wins. They are the first local options: each file starts with the values the assembler was given, an `.option` lasts until the end of its file, and a macro body runs with the values where the macro is defined (the assembler's `useLocalOptions`, for `.include` and macro calls). The others are now called global. REFERENCE explains both kinds. A loop's header is `AS <name> [FROM <start>]` and nothing else: `.REPEAT: unexpected 'junk' after the iterator: only FROM <start> can follow it.`, `.REPEAT: AS must be followed by the iterator's name.`, `.REPEAT: FROM needs an iterator: AS <iterator> FROM <start>.`, at the token._

### #150 — `.elseif` skipped in a false `.if` (TODO 1.39)

There was no `.elseif`. In a true branch, it was an error (`Syntax error - Unexpected directive 'ELSEIF'`), but in a false one it was skipped with the branch: `.if 0` / `nop` / `.elseif 1` / `rts` / `.else` / `brk` / `.end` → `00`. A branch not taken didn't check its directives at all: `.if 0` / `.foobar 1` / `.end` assembled.

_`.elseif` exists (4.3): that source gives `60`. A branch not taken, `.if`, `.elseif` or `.else`, rejects an unknown directive that starts a statement (at the start of a line, after a label or a brace) with the error it gives when assembled: `Syntax error - Unexpected directive 'FOOBAR'`. System variables and functions (`.db .pc`, `.len("ab")`) aren't directives and still pass. A test that put the linker's `.SECTION` in a false `.IF` of a source, or the assembler's `.DEFINE` in one of a link script, now expects that error._

### #149 — A one-char string as a number (TODO 1.40)

REFERENCE said `lda #"A"` loads `$41`: only on the 65C02. On the 6502 and the 6809, `lda #"A"` → `Expression did not evaluate to a number as expected.` On every CPU, `.db "A"+1` → `Binary operator '+' requires two strings.`, and `$80|"H"` → `requires two numbers.`: only `"H"|$80` and `"H"&n` worked, special-cased.

_Decided: a one-char string used as a number is its character code, with any operator, on either side, and wherever a number is expected (`lda #"A"`, `.fill 3, " "`): `"A"+1` is `$42`, `$80|"H"` is `$C8`, `-"A"` is `-$41`, and `"9"-"0"` is `9`. Between two strings, `+` still joins and `=` `==` `!=` compare the text: `"A"+"B"` is `"AB"`. A longer or empty string used as a number says so, `lda #"AB"`, `"AB"+1`, `1+"AB"`, `-"AB"` → `Only a one-character string can be used as a number: "AB".`, instead of `requires two strings` / `two numbers` or `did not evaluate to a number`. The 65C02-only `numberMax` is gone, and with it `lda #""` loading `0`._

### #148 — A string in `.dw` / `.dl` emits bytes (TODO 1.42)

`.dw "A", 1` → `41 01 00`, `.dl "A", 1` → `41 01 00 00 00`: a string was emitted one byte per character, misaligning the table, though `.dw 1` gives `01 00`.

_A string is its characters, one element each, as in `.db`: `.dw "AB"` is `.dw "A", "B"`, `41 00 42 00` (`00 41 00 42` on the 6809), and `.dl "A"` is `41 00 00 00`. A character above 255 is still an error._

### #147 — The "pass it as text" hint keeps the old `< >` delimiters (TODO 1.46)

An argument still written in the old text form, `m <#$4f>`, gave `'<#$4f>' is an addressing mode, not an expression. Pass it as text, in { }: {<#$4f>}.`: `{<#$4f>}` passes `<#$4f>`, not `#$4f`. Found migrating the conan game (`drawSprite <#$4f>,<#25>,<#16>`).

_When the argument is a whole `<…>`, the hint drops them and says why: `Pass it as text, in { }: {#$4f}. Text in < > is now in { }.` `#<$1234` and `<#$4f>+1` keep the plain hint._

### #146 — An instruction without operand takes a `}` as its operand (TODO 1.45)

`{ nop }` and `nop }` → `Invalid expression format.` on the 6502, `Invalid addressing mode for instruction NOP` on the 65C02: `getInstructionTokens` checked the line's first token for a `{`, not a `}`. `{ lda 1 }` worked, the `}` ending the operand. A directive had the same bug: `{ .org }` → `Unbalanced braces. Depth: 1`, `{ .once }` → `.ONCE takes no argument.`

_A `}` is never part of a line, first token included: `{ nop }` works, `nop }` is `Unbalanced braces. Depth: -1`, `{ .org }` is `Missing expression.`, and `{ .once }` works._

### #145 — A macro call swallows the `}` of a block on its line (TODO 1.44)

`{ copy 1, 2 }` → `Syntax error : Unbalanced braces. Depth: 1`, `{ nop0 }` → `Macro 'NOP0' expects 0 arguments, but got 1.`, and `m 1 }`, a `}` closing no block, assembled `01` silently: the call read the `}` as an argument. A call inside a directive's block was fine, the block being cut out first.

_Without parentheses, a call's arguments end at a `}` on its line, as an instruction's operand: `{ m 1, 2 }` works, and a stray `}` is `Unbalanced braces. Depth: -1`. `{ m 1, }` is `argument 2 is empty`._

### #144 — Macro text in `{ }`, `<` and `>` back to low and high byte (TODO 3.1)

`setp <addr, >addr` → `Unexpected 'ADDR' after '>': a macro argument in < > ends at its '>'.`: an argument starting with `<` was text up to a `>`, so the most common 6502 macro call needed `.lobyte(addr)` or `(<addr)`.

_Decided: text is written in `{ }`, as in ca65 (`copy {table,x}, $2000`, empty text `{}`), and `<` / `>` are low and high byte in any argument. Breaking: `< >` text is gone. A block's body is cut out before it runs, counting its braces, so a `{ }` argument works in any block, inline or not. `Unmatched '{' in macro arguments.` when the `}` isn't on the call's line._

### #143 — `.proc` without a name on its line (TODO 1.43)

`.proc` / `rts` / `.end` assembles nothing, silently: the name is read past the line, so `RTS` becomes the procedure's name. Same bug as `.macro`'s (1.27, #116).

_The name must be an identifier on the directive's line: else `A procedure needs a name.`, at the directive or at the wrong token (`.proc 12`, `.proc {` said `Expected a name after .PROC.`, at the directive)._

### #142 — `.function` renamed `.proc` (TODO 3.7)

`.function`, with its aliases `.fn`, `.proc` and `.procedure`, defined a routine whose labels stay local to it: a label scope, not a function usable in expressions, as the system functions are. That name is wanted for user functions (4.8).

_Decided: the routine is `.proc` / `.procedure`. `.function` and `.fn` are an error until user functions exist: `.FUNCTION is no longer a routine scope: write .proc clearScreen.`, at the directive. They are still block directives, so their `.end` closes them in a block that isn't assembled. A label redefined in the body says `in proc f`._

### #139 — An empty argument hides an unknown function (TODO 1.36)

`.min(1,,2)` → `Missing expression.` since #138: the function name was only looked up when the call was evaluated, after its arguments were parsed.

_The parser checks the name when it meets `.name(`: `Unknown function 'MIN'.`, at the name, whatever the arguments._

### #138 — An empty function argument (TODO 1.36)

`.array(1,,2)` → `Internal error: stack underflow for .ARRAY().`, `.len("ab",)` → `Function 'LEN' expects between 1 and 1 arguments, but got 2.`, and `.db (1,)` assembles `01`: an empty argument isn't `Missing expression.`, as an empty array element is (1.34).

_An empty argument, first, middle or last, is `Missing expression.`, located at the comma or `)` after it. `.array()` is still a call without arguments._

### #137 — Empty elements in an array literal (TODO 1.34)

`[1,,2]` is `[1, 2]`, `[1,]` is `[1]` and `[,]` is `[]`: `evaluateArray` skips an empty element, while `.db 1,,2` is `Unexpected comma.` and `.db 1,` is `Missing expression.` (1.10).

_Decided: an error, `Missing expression.`, as `.db 1,`: an empty element is evaluated as any other, also a trailing one. `[]` is still the empty array. Follow-up: 1.36 (an empty function argument)._

### #136 — An empty expression is 0 (TODO 1.10)

`lda #` assembles `a9 00`: the expression evaluator returns 0 for an empty expression. So do `lda ,x`, `lda (),y`, `jmp ()`, 6809 `ldd #`, ARM `mov r0, #`, RV32I `addi x1, x2,`, and `x =`, `x .equ`, `.let x =`, `.if`, `.db 1,`, `.dw`, `.fill`, `.res`, `.org` with nothing after them.

_Decided: an error, `Missing expression.`, in the evaluator: every CPU and directive gets it, located at the statement. Follow-ups: 1.34 (array literals), 1.35 (`.fill` / `.align` filler)._

### #135 — Definition columns (TODO 1.8)

What a directive defines (`.macro`, `.equ`, `=`, `.let`, `.define`, `.function`, loop iterators) records the directive name's column, after the `.`, while errors point at the statement's start. A redefinition shows `1:2` for the error and `1:3` for its `first defined here` note.

_Decided: the statement's start, as the errors. A definition records `currentStatement` (now in `DirectiveRuntime` too, for the macro and loop directives, and the linker's `=`), so its note has the error's column. The CLI's symbol index has it too (`;main.asm:3:3`)._

### #134 — `.incbin` path resolved from the project directory (TODO 1.33)

`.incbin "data.bin"` in `lib/lib.asm` reads `./data.bin`, while `.include "inc.asm"` in the same file reads `lib/inc.asm`: `IncbinDirective` calls `readBinaryFile(filename)` without the including file. The CLI then opens `<basedir>//data.bin`.

_Decided: as `.include`. The path is relative to the file the `.incbin` is in; in a macro body, the file the macro is called from (#133). The CLI's binary path has a single `/`._

### #133 — `.include` path in a macro body resolved from the caller's file (TODO 1.28)

`.include "inc.asm"` in a macro defined in `macros/macros.asm`, called from `lib/lib.asm`, reads `lib/inc.asm`, while the include chain says `included from macros/macros.asm`. Undocumented: which file should it be relative to?

_Decided: the caller's, as it was: a macro is text expanded where it's called (for nested macros, where the outermost one is called). Documented in `REFERENCE.md`, and pinned by tests. The chain still gives the `.include`'s place in the macro's file. Follow-up: 1.33 (`.incbin` paths)._

### #121 — Local label messages say `:` (TODO 1.32)

`Local label ':LOOP' defined without a preceding global label.`, `Local label reference ':LOOP' used without…`, `Undefined local label ':LOOP' in scope…`: the `:` is written in the message, whatever `local.prefix` is (`@loop` gives `':LOOP'`). The token doesn't keep its prefix (its `raw` is `loop`, which the listing prints).

_A local label token's `raw` has its prefix now (`@loop`), as a number's has its `$`, and the messages print it, as written. The phase error and the macro "addressing mode" message (`(ptr,x)` for `(:ptr,x)`) read `raw` too. The listing doesn't print local labels._

### #120 — `.option local_label_char` takes effect one line late (TODO 1.6)

`.option local_label_char "@"` / `:` / `nop`: the line after the `.option` was already lexed with the old prefix, so `:` is still accepted.

_Replaced by `local.prefix` and `anon.marker` (two chars, as most assemblers have), also in the project file's `input.options` / `AssemblerOptions.options`. The parser lexes again what the file being read lexed ahead with another label syntax, after an `.option` and back from an included file; an unknown char lexed ahead is an `INVALID` token, an error once read. Included files are cached per label syntax, and the options are set again in pass 2. An anonymous label stands alone (`!=` stays an operator with `anon.marker "!"`). Macro bodies keep the chars of their definition; in a block (`.if`, `.repeat`), an option takes effect after it. Follow-up: 1.32._

### #119 — A note at a definition in a macro body has its "call.body" line (TODO 1.30)

`.macro m` / `count:` / `count:` / `.end` / `m` → the error is right, but its note is `5.2:1: note: first defined here`: the line a symbol keeps is the macro's "call.body" line, with no file, as the include chain was before #117. The note needs the body line in the macro's file and its own macro calls.

_Where a symbol or a macro is defined is now resolved when it's defined, as an `.include`'s place (#117): the body line in the macro's file, the macro calls first in its include chain (`ErrorLocator.definitionSite`). The note shows them under it. The CLI's symbol index had the "call.body" line too (`;main.asm:4.2:3`)._

### #118 — Redefinition in a file included from a macro names the macro's scope (TODO 1.29)

`.macro m` / `.include "c.asm"` / `.end` / `m`, with `count:` twice in `c.asm` → `Symbol '@@macro_M_4#0__::COUNT' redefined.`: the internal scope name of the expansion.

_Not only from an included file: any symbol redefined in a macro body or a function was named by its scope's id (`@@function_NS::F::COUNT`, `Can't redefine constant '@@macro_M_5#0__::K'.`). Decided: `Symbol 'COUNT' redefined in macro m.`, `… in function f.` (a function's labels can't be named from outside: `f::count` is undefined). Namespaces keep `NS::COUNT`. The symbol table keeps a label for each scope a macro call or a function pushes. Follow-ups: 1.30, 1.31._

### #117 — `.include` in a macro body: include chain line (TODO 1.12)

An `.include` inside a macro body gets an `included from file:4.2:…` line (the macro's "call.body" line number).

_Decided: the chain gives the `.include`'s place in the macro's file, then the macro calls that led there (`included from macros.asm:4:2` / `in macro m, called at main.asm:3:2`), as an error in a macro body shows them. An include chain entry can be a macro call (`IncludeSite.macro`). The error locator only walks the macro expansions of the current file: for a macro called in a file included from a macro body, the calls' files were swapped. Follow-ups: 1.28, 1.29._

### #116 — `.macro` without a name on its line (TODO 1.27)

`.macro` / `foo` / `nop` / `.end` assembles silently: `parser.identifier()` reads past the line and takes `foo` as the macro's name. Same bug as `.define`'s (1.14).

_The name must be an identifier on the directive's line, in both passes: else `A macro needs a name.`, at the directive or at the wrong token (`.macro 12`, `.macro {` said `Syntax error - Expecting IDENTIFIER`)._

### #115 — `.define` redefinition message and missing name (TODO 1.13, 1.14)

- 1.13: missed by #75: `.define` has its own redefinition check, `Cannot redefine symbol 'X' (first defined at …)` (`define.directive.ts`): still the old message, without the `first defined here` note and its include chain.
- 1.14: `.define` without a name → `Syntax error - Expecting IDENTIFIER ` (trailing space, and it should say a symbol name is needed).

_`.define` now throws the symbol table's `Symbol 'X' redefined.`, with its `first defined here` note and include chain (1.13). The name must be an identifier on the directive's line: `.define` alone took the block's first word as the name and assembled silently. Both say `.DEFINE needs a symbol name.` `Parser.consume`'s message lost its trailing space. Follow-up: 1.27._

### #114 — `.def(m)` in a link script doesn't see its macros (TODO 1.26)

In a link script, `.def(m)` is `0` after `.macro m`, and `.undef(m)` is `1`: `link()` has its own `MacroHandler` but doesn't give it to the evaluator (#113's question).

_Decided: a link script's macros count, as in a source. `link()` passes `isMacroDefined` in its `EvaluatorHost`: a macro is defined once its `.macro` is reached._

### #111 — `.segment()` with a segment defined further down (TODO 1.25)

`s = .segment("DATA")` before `.SEGMENT DATA { … }` → `Segment 'DATA' not found.` in pass 1, while any other symbol may be used before its definition.

_In pass 1, an unknown segment gives `null` (not known yet), as the other functions do (1.5b). Pass 2 still reports a segment that is never defined. The dispatcher passes `allowForwardRef` to the handlers. Follow-ups: `.SEGMENT()` is registered twice, in `polyasm.ts` and `linker.class.ts`; `.segment("X").start` reads `.start` as a system variable; `.segment()` isn't in REFERENCE.md._

### #110 — An `.if .undef(…)` include guard drops the content (TODO 1.22)

`.if .undef("R_INC") {` / `R_INC = 1` / `spr: .db 7,8` / `}`, included once, emits nothing: pass 1 defines `R_INC`, so pass 2 skips the block. No error, an empty output. It only seems to work for macros, which are defined in pass 1 only. `.once` (1.11) is the include guard now, but the trap is there for any `.if .undef(X)` / `X = …` pair. Also, `.def("m")` is `0` for a macro `m`.

_Fixed: `.def` / `.undef` tell whether a symbol or a macro is defined at this point of the source, the same in both passes: a symbol keeps the pass that last defined it. A label defined further down isn't, in both passes. The argument is a name: `.def(X)` doesn't evaluate `X` (a function's `nameArgs`), so an undefined `X` isn't an error and `Z = 0` is defined. In a macro, `.def(param)` checks the name passed. Any other expression gives the name: `.def("X")`, `.def((name))` for the name held by `name`._

### #109 — `getExpressionTokens`' unused parameter (TODO 1.20)

`getExpressionTokens`' `inParentheses` parameter is never used.

_Removed, with the early break it guarded._

### #106 — An empty macro argument (TODO 1.23)

`.macro m x, y, z` / `.db y` / `.end` / `m 1,,2` emits `0`, silently. In a rest parameter (`.macro m ...a`), `.db a[1]` and `.db ...a` say `an array can't be emitted as is`, which is misleading. Decision needed: an error, or a value for an empty argument (as an omitted optional parameter?).

_Decided: an error, as an argument is a value. It's located at the comma: `Macro 'M': argument 2 is empty. An argument is a value; pass empty text as <>.` A trailing comma (`m 1,`) is an empty argument too, no longer dropped. Empty text is `<>`. Default values for parameters are an idea for later: 4.1._

### #105 — A macro call whose first argument starts with `(` (TODO 1.24)

Without parentheses around the arguments, a first argument starting with `(` is read as the `m(…)` call form: `m ($12,x)` (one parameter) → `Macro 'M' expects 1 argument, but got 2.`, `m (1+2)*3` → `Syntax error : NUMBER 3`. `< >` works around it (`m <($12,x)>`). Decision needed: how to tell the two forms apart (e.g. `m(` glued is the call form, `m (` starts an argument; or the `)` must end the line).

_Decided: `m(` glued is the call form, `m (` starts an argument, and substitution is explicit. An argument is a value, an expression evaluated where the macro uses it, in an instruction as in a directive: `lda a*2` with `m 1+2` is `lda 6` (it was pasted, 5). An argument in `< >` is text, pasted as is, in both call forms (`m(<($12,x)>)` failed). `#` or a comma in `( )` outside `< >` is an error that says to use `< >`: `m #5`, `m ($12,x)`. A text parameter forwarded alone stays text; a value is forwarded in `( )`._

### #104 — Macro call arguments split at a comma inside `[ ]` (TODO 1.15)

`m [1,2][1]` → `Macro 'M' expects 1 argument, but got 2.` (`macro/handler.ts`, both call forms). Without parentheses, `m ($12,x)` is also split in two. Decision needed: should `( )` group a macro argument too?

_Yes, decided: a comma inside `( )` or `[ ]` stays in its argument, in both call forms, as in the directives' values (#88). `m .iif(c,1,2)` and `m 1, ($12,x)` work too (since 1.24, `m 1, <($12,x)>`: an addressing mode is text). Inside them, `<` is an operator, not the start of a `< >` argument: `m .iif(a<b, 1, 2)` gave `Unmatched '<'`. `($12),y` still needs `< >`: its comma is outside the parentheses. A first argument starting with `(` is 1.24._

### #103 — Indexing a macro's rest parameter (TODO 1.18)

Indexing a macro's rest parameter gives the argument's tokens, not its value: in `.macro m(...a)`, `.db a[1]` → `an array can't be emitted as is`. `.for f of a` and `...a` evaluate them.

_An element of the rest parameter is now evaluated when it's indexed, like a macro argument: in the caller's scope, without the macro's parameters. It failed in every directive (`.dw`, `.text`, `.if`, operators…), and `.len(a[2])` silently gave the number of tokens of `"ab"`, 1. Instructions (`lda a[1]`) and forwarding (`inner a[0]`) already pasted the argument's tokens, and still do: an argument can be an addressing mode (`<table,x>`)._

### #102 — `.macro m {` without parameters (TODO 1.9)

`.macro m {` → `Unexpected token in the macro parameter list.`

_`getInstructionTokens` stopped at a `{`, except when it was the line's first token: the `{` was read as a parameter. A `{` is never part of the line now. `.macro m() {` and `.macro m a {` already worked. A stray `}` keeps its error (`.macro m }`, `nop }`)._

### #101 — `.define` block inside `.repeat 1 { … }` (TODO 1.2)

`.repeat 1 {` / `.define X` / `abc` / `.end` / `}` / `.db 1` → `Missing .END for the .DEFINE block.` The raw block isn't replayed correctly in a brace block. Check how `getBracedBlock` stores the `RAW_TEXT` token.

_The block was stored right in pass 1, but pass 2 read it again from the source, past its end: in a `.repeat` (`{ }` or `.end`) or an `.if { }`. Pass 2 now replays the `RAW_TEXT` token, as `.hex` does. In a macro body the block lost its start silently (`abc` gave `"c"`): reading the `.define` line lexed a token of the block. Only that line is lexed now._

### #100 — A file included twice breaks what follows (TODO 1.21)

A file included a second time breaks the statements after that `.include`: `.include "r.asm"` / `.include "r.asm"` / `.db 9` → `Cannot read properties of null (reading 'value')` at `.db 9`. Nothing after it (the existing test) hides it. It blocks a resource included in two places, in two namespaces too. In pass 1, `startNewStream` starts a lexer stream on the file again, but `pushTokenStream` takes the parser's cached tokens: that lexer stream is never read, and the including file goes on from it.

_A file already read to its end has its tokens cached: pass 1 now pushes them without starting a lexer stream on the file, as pass 2 does. Raw blocks (`.hex`) and labels in two namespaces work in the second copy._

### #99 — No include guard (TODO 1.11)

A file defining macros can't be included by two modules (`Macro … redefined`). Decision needed: `.include once`, an automatic once-only include, or `.ifdef` / `defined()`.

_`.once`, decided: the file says it holds definitions, like C's `#pragma once`, and an `.include` of it after its `.once` was reached does nothing. Files are known by their resolved path. An automatic once-only include would forbid a resource included in two places; `.include once` must be remembered by every includer; a guard written with `.if .undef(…)` breaks with two passes (1.22). Both passes skip the same includes: the files seen are forgotten before pass 2._

### #98 — Indexing an array defined later (TODO 1.19)

Indexing an array defined later fails in pass 1: `.db t[1]` / `t = [2,3]` → `Attempted to index a non-array value.` The evaluator should pass `null` (not known yet) through `[ ]` in pass 1, as for 1.5. Same for a field: `.text .str(cfg.n)` / `.define cfg` … → `Invalid property access on a non-object value.`

_In pass 1, an array, an index or an object not known yet now gives `null`, and what is known is still checked (`5[i]`, `t["a"]`). An index not known yet was taken as 0: `.text ["a","bc"][i]` was placed with `"a"`, a phase error if a label followed. In pass 2, a `null` index is now an error, not 0._

### #97 — Functions don't pass `null` through (TODO 1.5b)

With `msg` defined later, `.db .len(msg)` → `.LEN() requires a string or array argument.`, `.db .str(msg)` → `First argument to .STR() must be a number.` In pass 1 they should give `null` (not known yet), as the operators do, and let pass 2 or the directive report it.

_The dispatcher does it for every function in pass 1: an argument not known yet makes the call give `null` without running it. A function says how many leading arguments it needs (`knownArgs`, all by default): `.iif` only its condition, `.push` its array, `.def` / `.undef` / `.array` none. The "must be defined before" messages named the function (`.text .str(n)` → `'STR' must be defined…`): they skip the identifier after a `.` now, and say `'N'`._

### #96 — String operator with a symbol defined later (TODO 1.5)

`.text "a" + msg` with `msg` defined later → `Binary operator '+' requires two strings.` The evaluator should pass `null` (not known yet) through string operators in pass 1. The string directive then reports "must be defined before it is used".

_Now `.TEXT: 'MSG' must be defined before it is used here (its length is needed to place what follows).` Only a string on the left failed: `msg + "a"` already passed `null` through, as numbers do._

### #95 — Macros forget their symbols between the passes (TODO 1.1)

A macro call's scope is deleted after pass 1, so pass 2 doesn't know the body's symbols yet when it needs them:

| Source                                                   | Result                                               |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `.macro m` / `beq skip` / `nop` / `skip:` / `.end` / `m` | `Undefined symbol 'SKIP'.` (pass 2)                  |
| `.macro m` / `k .equ 1` / `.db k` / `.end` / `m`         | `Unknown symbol "@@macro_M_5__::K".`                 |
| a `.define` block in a macro body                        | `assignVariable: Unknown symbol "@@macro_M_7__::X".` |

_Each call's scope is now kept from pass 1 for pass 2 (`restoreAndPushScope` / `popScope({ wannaSave })`, as `.function` does). The call line didn't make the scope names unique: calls from a loop (`.repeat`, `.for`) or from two files share it. The expansions are now numbered in each pass too (`@@macro_<name>_<call line>#<n>__`), the way the anonymous labels are matched between the passes._

### #90 — Spread (TODO 1.17)

**Decided:** `.db 1, ...table, 2` emits each element as if written there (strings too), in `.db` / `.dw` / `.dl` and probably `.text`. `...` is already the lexer's `REST_OPERATOR`, as in macro rest parameters. The array error then adds "or spread it".

_Done in `.db` / `.dw` / `.dl` and the string directives (`.text`, `.cstr`, `.pstr`, `.pstrl`), a macro's rest parameter included. The array must be known in pass 1: an array defined later is an error, like a string. Spreading in a macro call (`m(...list)`) isn't supported._

### #89 — A whole array in `.db` (TODO 1.16)

`.db [1,2]` (a whole array) → `Unexpected object value 1,2.` Decision needed: emit its elements, or a clear error.

_An error, decided: `[1,2]` doesn't say it means its elements. Now `.DB value: an array can't be emitted as is: index it to emit one of its elements.` (or `an object … use one of its fields`), at the value. An array defined after the `.db` was silently emitted as nothing (`.db t` / `t = [1,2]`): it's the same error now._

### #88 — Array literal indexing (TODO 1.4)

`.db [1,2][0]` → `Mismatched brackets in array literal.` (indexing a _named_ array works).

_The indexing worked: the comma inside the brackets cut the `.db` value. The directives' values (`.db`, `.dw`, `.text`, `.let`…) and the `.fill` / `.align` arguments are now only split at the commas outside `( )` and `[ ]`: `.fill .iif(1,2,3), $AB` failed too. Strings no longer count as brackets: `.db "(", 1` and `.db "["` failed._

Its follow-ups are 1.15 to 1.20.

### #77 — `.define` on the last line (TODO 1.7)

`.define X` on the last line (no newline) → `Syntax Error - Unexpected token in .DEFINE`, which is misleading.

_Now `Missing .END for the .DEFINE block.` `.define X FROM "file"` on a last line, which was rejected, works too._

### #76 — `.repeat n` with `n` defined later (TODO 1.7)

`.repeat n` with `n` defined later → `.REPEAT count: null isn't a whole number (0 or more).` It should say the count must be defined before the `.REPEAT`, as the string directives do.

_Now `.REPEAT: 'N' must be defined before it is used here (the count is needed to place what follows).` `.for x of list` had the same bug (it crashed with `object null is not iterable`) and is fixed too._

## CPU back-ends (TODO 2.1)

- **#176** (TODO 2.1) — **65C02: missing `STP` / `WAI` and `BBR` / `BBS` / `RMB` / `SMB`**: `stp` and `wai` silently became labels, emitting nothing, and `bbr0 $12,label` or `smb0 $12` → `Syntax error : NUMBER 18`. _The 65C02 is WDC's W65C02S: `P65C02` adds two opcode sets, `ROCKWELL_BITOPS` (`RMB0..7` / `SMB0..7 zp`, `BBR0..7` / `BBS0..7 zp,label`) and `WDC_ADDITIONS` (`STP`, `WAI`, which the 65816 has too). A Rockwell R65C02 would be the same profile without `WDC_ADDITIONS`. `BBR` / `BBS` take a new mode, `ZEROPAGE_RELATIVE` (3 bytes), its operands split at the first comma outside parentheses; the zero page address is checked (`Zero page address 4660 is out of range ($0..$FF).`), the branch as for `BNE`, and an operand without a comma → `BBR0 takes a zero page address and a branch target: 'BBR0 $12,label'.` The 6502 doesn't change._
- **#175** (TODO 2.1, 1.3) — **6502 / 65C02 duplication** (architecture #3): two handlers of about 600 lines, nearly copied, with `selectAddressMode`, `rejectSuffix` and the suffix code in both, and only the 65C02 checking its operands: on the 6502 `lda $12345` → `ad 45 23`, `lda #$1FF` → `a9 ff`, `lda ($1234),y` → `b1 34`, silently truncated (1.3). _One `Mos65xxHandler`, configured by a profile (`P6502`, `P65C02`): the CPU's name, its suffixes (`{ B: 1, W: 2 }`) and the opcode sets it's made of, written once by origin (`NMOS`, `CMOS_ADDITIONS`) as mnemonic → mode → opcode, the size following from the mode. The handler merges them per mnemonic into its own maps, never writing into the shared, read-only sets, and throws when two give the same mnemonic and mode (`The test's opcode sets give LDA IMMEDIATE twice.`). Composition, not `Cpu65C02Handler extends Cpu6502Handler`: the 65816 isn't a 65C02 (`$07` is `RMB0 zp` on one, `ORA [dp]` on the other). `Cpu6502Handler` / `Cpu65C02Handler` are constructor-only subclasses, and the modes have one set of names (`ZEROPAGE_X`, no `M6502_` / `M65C02_`). The 6502 takes the 65C02's code path: its operands are checked (`Address 74565 is out of range ($0..$FFFF).`, `Immediate value 511 doesn't fit in a byte (-128..255).`, `Zero page address 4660 is out of range ($0..$FF).`), `asl` alone is `asl a`, and, decided, an operand starting with `(` is an indirect mode or an error: `lda (2+3)*4` → `Invalid addressing mode for instruction LDA`, as on the 65C02 (it was `a5 14`; see 3.10). `inc a` → `Undefined symbol 'A'.`, as on the 65C02 a lone `A` is a symbol for an instruction without an accumulator form. The 65C02 doesn't change. Follow-ups: the 65816 parts in 4.18, `ROCKWELL_BITOPS` in 2.1._

## Linker (TODO 2.2)

- **#87** — A write past the end of a fixed segment is accepted. Through a linker script it gives `RangeError: Invalid array length`. _A write that starts in a fixed segment and goes past its end is now an error at its line: `Write out of bounds: address $804 outside fixed segment 'SEG' …`, as one that starts past it already was._
- **#87** — `.WRITE SEGMENT` / `.WRITE MODULE` in a `.SECTION … AT` silently go to the end of the output, not to the section. With `.OUTPUT "x" FIXED 4`, `.SECTION S AT 2`, `.WRITE SEGMENT "CODE"` puts `CODE` at 0. Either write them to the section or make it an error. They ignore `.WRITE … AT` too. _They now go to the section, and take `AT`, like the other writes. A fixed segment is padded to its size._
- **#86** — `.OUTPUT … FIXED n` too large fails the same way before the friendly check. _Now `Output file is too large. Max size is n bytes, …`._
- **#86** — `.SECTION x AT off` is misplaced when the output isn't fixed. `.WRITE WORD/LONG … AT` writes one element (truncated). `STRING` / `BYTES` ignore `AT`. _Every `AT` write is now applied like a section: in order, over the complete output, padded up to it when it isn't `FIXED`. `WORD` / `LONG` follow `.ENDIAN`, and `.PC` in a section is its offset in the output. A negative offset is an error. The directive's file is now `section.directive.ts`._
- **#85** — The linker prints a debug `Linker` / `- CODE offset: …` after each run (`console.log` in `linker.class.ts`). _It goes to the listing now, with the linker script's report and `.log`s, when `output.listing.linker` is on (`log.linkerEnabled` for the library). Off by default: the console only shows warnings and errors._
- **#84** — **Linker errors aren't located:** `link()` doesn't use `AsmError`. Messages like `Syntax error in line N` and the linker's `.SEGMENT()` / system variable errors still carry their line. Give `link()` the same mechanism: `toAsmError`, statement token, file.

    _The assembler's locating code is now shared (`ErrorLocator`): a linker error or warning is located at its token, else at its statement, in the script or included file, through macro calls, with the source line. The messages no longer carry their line._

- **#83** — A `.WRITE` value isn't parsed unless it's a number, a string or a symbol name. Parentheses are needed:
    - `.WRITE SEGMENT s.name` → `Invalid syntax: '.' must be followed by an identifier.`
    - `.WRITE BYTE .lobyte($1234)` → `Unknown system variable: LOBYTE`
    - `.WRITE BYTES [1, 2]` → `Mismatched brackets in array literal.`
    - `.WRITE SEGMENT(s.name)`, `.WRITE BYTE(.lobyte($1234))`, `.WRITE BYTES([1, 2])` work.

    _The value now runs to the end of the line or to `AT`: both syntaxes work. A missing value is an error._

- **#80** — `linker_script.md` still describes jsasm6502-era syntax. _Rewritten from the current code, each behaviour checked with a script, with a Limitations section._
- **#80** — `;` isn't a comment in a linker script (`Unexpected character ';'`). _By design: it tells a linker script from assembler source. Now documented._
- **#79** — In a linker script, `.ENDIAN BIG` changes `.WRITE WORD/LONG` but not `.WORD`, `.LONG` or the length of `.PSTRINGLONG`, which stayed little-endian. _They now follow `.ENDIAN`._

## CLI (TODO 2.3)

- **#157** (TODO 1.54) — The `.sym` file lists a `.proc`'s name but none of its symbols: `.proc clear` / `loop:` / … / `.end` gives `CLEAR` and no `loop`. A proc's scope is taken out of the symbol table when it closes, kept aside for the next pass, and the file only read what was left. _Decided: a proc's symbols follow its name, as local labels do: `CLEAR.LOOP: label number = $0800`, `CLEAR.COUNT: var number = $08`, a nested proc's `OUTER.INNER.LOOP`, in the proc's namespace. The symbols of a macro call are still left out. The proc's scope id is built in one place (`procScopeId`)._
- **#155** (TODO 1.53) — The `.sym` file keys the default namespace `'%%GLOBAL'`, the table's internal name; a string isn't escaped: `msg = "he said \"hi\""` gives `string = "he said "hi""`. _The default namespace is `global`, as REFERENCE calls it, followed by its metadata as other namespaces are (`global [KIND=main]`, `GFX [BASE=8192, KIND=screen]`: a debugger reads it); a string is written as JSON: `string = "he said \"hi\""`._
- **#108** — Relative config path applied twice (`chdir` + `dirname`), so `tsasm proj/conf.yaml` fails. _The project directory is made absolute once and every path of the project file is resolved against it, without `chdir`: the linker script and its includes were the ones read from `proj/proj/`._
- **#75** — Included file paths come out as `./././nope.asm`. _Now normalized (`includes/x.asm`), and every error in an included file says through which includes it was reached._
- **#72** — An empty `.lst` is always created in the current directory. _The listing is only written when enabled, relative to the project file, its directory created; a write failure is a clean error, not a node crash._
- **#69, #73** — The config validator crashes on `cpu: 6502` and on an empty file. _A missing file and YAML syntax errors are reported too, as `file:line:column: error:`._

## Build (TODO 2.4)

- **#123** — Type errors don't fail the build, and CI doesn't run `check` / `build`. _Rollup's typescript plugin now has `noEmitOnError: true`; CI runs `pnpm check` and `pnpm bundle`, a new script with `build`'s rollup part minus the version bump._
- **#91** — `tsconfig`: `moduleResolution: node` and `esModuleInterop: false` are deprecated in TS 6. Use `"bundler"`. _Now on TypeScript 6.0.3, with `moduleResolution: "bundler"`, no `esModuleInterop` (always on in TS 6) and `types: ["node"]` (TS 6 no longer includes every `@types` package). The build output is byte-identical to TS 5.9's._
- **#69** — `build:cli` / `build:lib` are broken on macOS/Linux. _Now `rollup --environment TARGET:…`._

## Architecture (TODO 2.5)

- **#132** — **#10, dead code: tests asserting buggy behaviour** (e.g. "integer division" expecting `13/4` as a fraction). That one doesn't: `/` is not an integer division, as `REFERENCE.md` says; only the test's name was wrong. No other test was found asserting a bug. _Done: the test is named "should not do an integer division" and expects `3.25`. #10 is complete with #128, #130 and #131._
- **#131** — **#10, dead code: `isVolatileScope` / `restoreAndPushScope`:** to check. Both are used: macro calls and functions get their scope back in pass 2 with `restoreAndPushScope`, and `=` uses `isVolatileScope` to define a variable pass 1 didn't (a macro called in pass 2 only, or an `.if` block in a function run in pass 2 only); no test covered that. What nothing calls is `pushScope()`, with its `scopeCounter` and `@@LOCAL_` names, since loops lost their scope (#45) and macro calls moved to `restoreAndPushScope` (#95). _Done: `pushScope()` is removed. Two tests cover `=` in a block run in pass 2 only; without the branch they fail with `assignVariable: Unknown symbol`._
- **#130** — **#10, dead code: commented-out blocks:** old code was left commented out in 15 source files (debug `console.log`s, a `try`/`catch` in `.LOG`, a `.CPU`-in-a-macro check, an unused 65C02 accumulator case…) and in 8 test files (assertions, a `.NAMESPACE` test expecting an error that bare `.NAMESPACE` no longer gives). _Done: removed. The three that recorded a choice are now one-line comments: `/` is not an integer division, the logger's warnings and errors ignore `enabled`, property access works on arrays for the linker's `SEGMENTS`._
- **#128** — **#10, dead code: token types:** the lexer's `TokenType` lists 9 types it never emits (`HASH`, `LPAREN`, `RPAREN`, `PLUS`, `MINUS`, `MULTIPLY`, `DIVIDE`, `COMMENT`, `NEWLINE`), left over from when these chars had their own tokens; the old `case`s are still there, commented out. _Done: the types and the commented-out code are removed. `#`, `(`, `)`, `+`, `-`, `*`, `/` are `OPERATOR` tokens, comments and newlines give no token, as before._
- **#125** — **#9:** the lexer decides unary minus from `lastToken`. That belongs in the expression parser. _Done: `-` is always an operator in the lexer, `lastToken` is gone. The folding hid a parser bug, fixed: after a comma (function arguments), prefix operators were read as binary (`.IIF(1, -X, 0)`, `!X`, `<X`, `*`…)._
- **#124** — **#5, global mutable state:** module-level `blockDirectives` / `rawDirectives` are mutated by `register()`, so the linker's `SECTION` leaks into every parser. _Done: they are `Parser` fields, filled through `Parser.registerDirective()`; the assembler's and the linker's parsers each have their own. `.SECTION` is no longer a block directive (it has no body, and took the `.END` of an enclosing `.IF`)._
- **#113** — **`.def()` / `.undef()` re-registered:** they get `isMacroDefined` by registering them again (`registerDefFunctions`, `polyasm.addFunctions()`), so which one wins depends on the call order. Make it an optional `EvaluatorHost.isMacroDefined`, and both go away. _Done: registered once with the default functions, on the host's `isMacroDefined`. In a link script, `.def(m)` still doesn't see the script's macros (the linker passes none): a question for the maintainer._
- **#112** — **`.SEGMENT()` registered twice** (1.25's follow-up), with the same code, by the assembler and by the linker. _The evaluator gets an `EvaluatorHost` (`resolveSysValue`, `findSegment`, optional `findNearestLabel`) instead of positional callbacks; `.SEGMENT()` is a default function on `findSegment`. An evaluator can be tested with a stub host._

## Features (TODO 4)

- **#181** — Fixups (TODO 4.19, step 3). Since #180, `jmp label`, `lda #<label` and `.dw label` with a relocatable value were errors: nothing said where an address was written, for the loader to relocate it. And a 65xx branch from a relocatable segment to a fixed address was computed from the segment's offset, silently: `nop` / `bne $10` → `D0 0D`. _Decided: each relocatable value written records a fixup in its segment's `relocs`, `{ offset, size, shift, segment, targetOffset }`, `shift` being 0, 8 (`>`) or 16 (`^`); the bytes hold its offset. Data: `.dw label` / `.dl label` record 2 / 4 bytes; `.db >label` one; `.dw <label` is the byte then 0, its fixup on the byte (the last one in big-endian); `.db label` → `.DB value: CODE+$0001 is a whole address: take one byte of it with <, > or ^.` 6502 / 65C02 operands, read through a new `OperandReader` the CPU interface gets: a relocatable address is always absolute (`lda msg` → `AD 00 00`), 2 bytes recorded; an immediate takes `<`, `>` or `^` (`lda #main` → `LDA #CODE+$0001: an immediate is one byte, take one of the relocatable address with <, > or ^.`); zero page modes and `.b` → `LDA needs a zero page address here, and CODE+$0001 is relocatable: it can't be in zero page.` A branch target is an address in the branch's segment: inside a relocatable one, the distance of the offsets, no fixup; to another segment, or from a relocatable one to a fixed address → `A branch from relocatable segment 'CODE' can't reach $1000: the distance is only known when it's loaded.` The other CPUs: `CODE+$0001 is relocatable, and the 6809's operands can't take one: their fixups aren't recorded.` Follow-up: 1.66._
- **#180** — Relocatable values (TODO 4.19, step 2). A label in a relocatable segment was its offset, a plain number: `x = main * 2`, `.if main`, `msg - main` across two segments, `.hex(main)` all gave a number computed from the offset, silently; `lda main` chose zero page for an offset under $100; the symbol file said `label number = $0001`; and linking without a script put the segment at 0, among the fixed ones. _Decided: its labels, `*`, `.PC` and its anonymous labels are a segment and an offset, `CODE+$0001`. `label + n`, `n + label`, `label - n` stay relocatable; two labels of the same segment give a number; `<`, `>`, `^` and `.lobyte()` / `.hibyte()` / `.bankbyte()` give one byte of it, still relocatable (`>CODE+$0001`). Any other operator → `Operator '*' can't take CODE+$0001, a relocatable value: it only takes + n, - n, - a label of its segment, and <, > or ^.`, two segments → `DATA+$0000 - CODE+$0001: two relocatable segments are a distance apart only known when they're loaded.`, a function but `.iif()`, `.array()`, `.push()`, `.pop()` → `.HEX() can't take …`, and where a number is needed (`.if`, `.assert`, `.repeat`, `.fill`, `.align`, `.org`, segment bounds) → `CODE+$0001 is relocatable: its address is only known when it's loaded, and a number is needed here.` Operands and data, until step 3 records their fixups → `CODE+$0001 is relocatable, and operands and data can't take one yet: their fixups aren't recorded.` The symbol file writes `label reloc = CODE+$0001`, the listing `CODE+0001     main:`. Linking without a script → `Segment 'CODE' is relocatable: it needs a linker script to place it.` (an empty one is ignored)._
- **#178** — Relocatable segments, the declaration (TODO 4.19). Every segment had an address: nothing declared one placed when it's loaded, as an Apple IIgs OMF segment is. And `.segment X { size: 4 }`, with no `start`, was put at `$0000`, silently. _Decided: `.segment CODE { relocatable: true }`, or `reloc: true`, in any case, its value the word `true` or `false`; the same keys in the project file's `input.segments`. A relocatable segment has no `start` (`A relocatable segment has no 'start': its address is only known when it's loaded.`) nor `end`; its `size` is optional, without one it grows. It starts at 0, and its labels are offsets from 0 until relocatable values (the rest of 4.19). `.org` and `* =` in it → `Segment 'CODE' is relocatable: it has no address until it's loaded, so .ORG and * = can't set one.` A fixed segment needs a `start`: `.segment X { size: 4 }` → `.SEGMENT definition requires 'start','end' or 'start','size' parameters.`, a project segment without one → `Segment 'X' needs a 'start' address, or 'relocatable: true'.` The linker script reads `seg.relocatable`; the segment map writes `relocatable: true` in place of the start. Follow-ups: 1.65, and linking a relocatable segment without a script (4.19)._
- **#177** — Bank byte: unary `^`, `.bankbyte()` / `.bkbyte()` (TODO 4.20). Nothing gave the bits 16–23 of an address, for a 65816's `lda #^table` / `pea ^table`: `^` was only XOR (`lda #^$123456` → `Binary operator '^' requires two operands.`), and `>` gives bits 8–15. _Decided: as ca65, `^` is the bank byte where an operand starts and XOR after one, as `<` and `>` are low / high byte or comparisons: `lda #^$123456` → `A9 12`, `1 ^ ^$030000` is `2`. It binds as the other unary operators, `^$123456 + 1` is `$13`. `.bankbyte(<value>)`, and `.bkbyte(<value>)` after `.lobyte()` / `.hibyte()`, give the same. On a relocatable value, the fixup it records is left to 4.19._
- **#174** — `.function name(params) { … .return value }`, user functions, the block form (TODO 4.8). A one-line function couldn't loop, branch or hold a variable: no `reverse(b)` over 8 bits, no search in a table, no recursion with an end. _Decided: without `=`, the body is a block, in `{ }` or up to `.end` as for `.macro`. A call runs it in the call's scope, as its own stream, to its end while the calling statement waits (`Assembler.runFunction`), with the local options of where it's defined; `.return <expression>` (new) gives the value and leaves the body, as `.break` leaves a loop (`StreamState.functionCall`). The body only computes a value: assignments (`=`, `.let`), `.if` / `.elseif` / `.else`, `.repeat`, `.for`, `.break`, `.return`, `.error`, `.warning`, `.log`, `.assert`; anything else is an error when it runs (`Instruction 'lda' can't be in a function: a function only computes a value.`, also for a label, a macro call, data, `.org`, `*`, `.equ`, `.option`, a nested `.function`). Its variables are the call's, even with an outer symbol of the same name: that one is read until assigned, never changed (`=` in pass 2 and `.let` no longer reach it from a call; `.let "ns::x"` is an error). A body ending without `.return` → `Function 'f' ends without .return.`; `.return` out of a function → `Unexpected directive '.RETURN': it isn't in a function.`; `.break` out of a loop of the body → `… it isn't in a loop of the function 'f'.` The body isn't listed (`ILister.mute()`), its `.log`s are. An error in a function is located at the call, its note now at its place in the body or expression (`note: in function f`), at the definition when that's unknown. In a block not assembled, a block function keeps its `.end`. Follow-ups: 1.64, 3.9, the system functions of 4.7._
- **#173** — `.function name(params) = expression` / `.fn`, user functions, the one-line form (TODO 4.8). Nothing computed a reusable value: a formula was written again at each use (`sta $0400 + 5*40 + 10`), and a macro can't give a value to an expression. _Decided: `name(…)`, the `(` glued to the name as for a macro's `m(1, 2)`, calls it in any expression; `ns::name(…)` from another namespace. The arguments are values, evaluated at the call. Each call has its scope, on top of the scopes where the function is defined (`PASymbolTable.withFunctionScope`): the parameters are local, the expression reads the symbols of where it's defined and `*`, not the caller's macro parameters or variables. A function is a symbol whose value is a `UserFunction`: one name for a function and a symbol is `Symbol 'F' redefined.`, the name without a call `'f' is a function: call it, f(…).`, and functions aren't in the `.sym` file. A function must be defined before its call, in both passes (`Unknown function 'f'.`, as `.def()` says). An error in the expression is located at the call, with `note: in function f, defined here` for the innermost function. Recursion, direct or through another function, is limited by the new global option `function.recursion` (short `fr`): `0` to `256`, default `64` → `Function 'f' calls itself more than 64 deep (.option function.recursion).`, or with `0` `Function 'f' calls itself, and .option function.recursion is 0.`; nested calls of other functions don't count. A range is said `'function.recursion' must be a whole number from 0 to 256.` Without parentheses, `.function clearScreen` still says to write `.proc`, and now how a function is written; it's still closed by its `.end` in a block not assembled. The block form (`{ … .return }`) is `A function's body is one expression for now: …`. Follow-ups: 1.62, 1.63, the block form and the others in 4.8._
- **#171** — `.break`, to leave a loop early (TODO 4.7). A loop couldn't stop before its last iteration: a search, a table up to a terminator, a nested loop's triangle needed the rest of the body in an `.if`, and `.exitmacro` left the whole macro. _Decided: it ends the innermost `.repeat` / `.for` and what it's in within the loop (an `.if` branch, an inner block), with its iterations left; its iterators are put back, what the iterations run defined stays. What's left isn't assembled, but its directives are checked as in a branch not taken. A macro body and an included file see only their own loops: at the top level, in a `.proc` out of a loop, in a macro called from a loop or in a file included from one → `Unexpected directive '.BREAK': it isn't in a loop.` (`… of the macro 'M'.`, `… of the included file.`); text after it → `Unexpected '1' after .BREAK.`. Loop streams are marked `loop`, and the end shared with `.exitmacro` is `Parser.exitTokenStreams(directive, at)`. Follow-up: `.continue` (4.7)._
- **#168** — `.exitmacro` / `.exitm`, to leave a macro early (TODO 4.7). A special case had to wrap the general one in an `.else`, a loop over a macro's arguments couldn't stop, and a recursive macro's end needed the rest of its body in an `.if`. _Decided: as ca65's `.exitmacro`. It ends the innermost macro's expansion and what it's in within the body (an `.if` branch, a loop and all its iterations, its iterators put back); a macro calling it goes on. What's left isn't assembled, but its directives are checked as in a branch not taken (the check moves from `IfDirective` to `Parser.checkDirectives`). At the top level, in a loop or a `.proc` outside a macro, or in a file included from a macro → `Unexpected directive '.EXITMACRO': it isn't in a macro.`; text after it → `Unexpected '1' after .EXITMACRO.`. Follow-ups: `.break` for loops (4.7), 1.61._
- **#167** — `.assert <condition> [, warn | err] [, <value> …]` (TODO 4.7). Checking an invariant (code size, a table within a page) took `.if !(cond)` / `.error "…"` / `.end`. _Decided: a false condition is an error by default (`Assertion failed`, or the values as `.error` prints them), a warning with `warn` / `warning` as the second argument, a word alone in any case; `err` / `error` says the default. The condition is checked once, in pass 2, so it can use labels defined after it; pass 1 skips the line. An empty argument is `Missing expression.`, text after an argument `Unexpected 'x' after the expression.`. In a loop, each expansion is checked; in a branch not taken, none._
- **#166** — `.option` values on the command line (TODO 4.13). To assemble once with another option than the project file's, e.g. `listing.data` `expand` when `input.options` says `fold`, the project file had to be edited. _Decided: `-O listing.data=expand` (can be repeated), `--listing.data expand`, `--listing.data=expand`. Each option declares a short name in `options.ts` (`OPTION_SHORT_NAMES`), not computed from its initials, so adding an option never changes what one means: `lp`, `am`, `lc`, `ld`, `rs`, `fs`, accepted wherever a full name is (`-O ld=fold`, `--ld fold`). Every `.option` name is accepted, from `DEFAULT_OPTIONS`, and `--help` lists them with their short name and values from the same table. The command line's values are merged over `input.options` before the `Assembler` is built, so a `.option` in the source still applies after them; the library doesn't change. An unknown name lists the known ones, a wrong value says what the project file and `.option` say (`'listing.data' must be one of 'expand', 'fold'.`), an option given twice is an error; `repeat.start` / `for.start` are read as numbers. Not done: flags named after a value (`--fold`), and forcing a value over the source's `.option`._
- **#164** — `.option listing.data "<mode>"`, also in `input.options`: `expand` (default) or `fold` (TODO 4.9). A generated table was listed one line per iteration (`.repeat 128` / `.db …` gave 128 lines), a long `.db`, `.hex` or `.incbin` on as many lines as it has bytes. _Decided: `fold` lists a data statement's first 8 bytes, a `…` when more follow, its text cut at 48 chars; a loop that only emits one block of data is one data statement, its header as the text; a loop that does more (an instruction, an assignment, a `.log`) is listed line by line. `expand` keeps the listing, except that `.hex` now lists its bytes (it listed `.hex "<20 bytes>"`, no address), `.incbin` lists them as the other data do (it had its own `[PASS 2] $1048: 01 02 03 04... | Line 3: …` line, at the address after the data), and `.for`'s header is written as in the source (`.for x of list AS i FROM $00`, not `.for x, of, listASiFROM$00`). Follow-ups: 1.58, 1.59, 1.60._
- **#161** — The `Assembler` is given the CPUs `.cpu` can switch to (TODO 4.12). It took one `CPUHandler`, and `.cpu` created any CPU from the full list in `src/cpu/index.ts`: a library build bundled them all, and the error didn't say which names exist. _Decided: the code says which CPUs exist, the project file only picks one, so the two can't disagree. `new Assembler(cpu | cpu[], fileHandler, options)`: `.cpu` switches only to these, by their `cpuType` in any case, and `Unknown CPU name '6809': the CPUs are 6502, 65C02.` The source starts with the one the new `cpu` option names, wherever it is in the array, else the first. No CPU → `The assembler needs a CPU.`, two with one name → `Two CPUs are named '6502'.` The CLI gives every CPU it has, and `input.cpu` as the `cpu` option (`6502` by default). The library bundle drops from 175 to 132 KB. A conf listing the CPUs would need a discovery of the handlers, left for when a custom handler can be loaded._
- **#156** — The `.sym` file says what a symbol is: `var` (`=`, `.let`, `.define`), `const` (`.equ`) or `label` (a label, a local label, a `.proc` name), before its type (TODO 4.11). `COUNTER: var number = $02 ;t.asm:3:9`, `SCREEN: const number = $0400 ;t.asm:1:8`, `START: label number = $0800 ;t.asm:7:1`. _Decided: every line keeps the pattern `<kind> <type> = <value> ;<file>:<line>:<column>`, a label's type too (always `number`), so a debugger reads them all the same way. The symbol table records a label as one (`defineLabel`); it's still a constant. README describes the file._
- **#150** — `.elseif <condition>`, between `.if` and `.else`, in both forms (`.end` and braces), in sources and link scripts (TODO 4.3). _A condition is evaluated only while no branch before it was taken: `.if 1` / … / `.elseif .nope()` doesn't read the second one. An `.elseif` without a condition is `Missing expression.`, even when not evaluated. `.else` is the last branch: `.elseif` or `.else` after it → `Unexpected .ELSEIF: the .ELSE branch must be the last one.` Fixes 1.39._
- **#126** — `.option listing.case "<case>"`: how the listing writes the mnemonics, registers and symbols of the instructions: `upper` (default), `lower` or `source` (as written, suffix included). `Sta Screen,x` is listed `STA SCREEN,X`, `sta screen,x` or as written. Also in the project file's `input.options`. _Each option now has its own allowed values. A local label is listed with its prefix (`:LOOP`, was `LOOP`), an anonymous label reference as written (`:-`, was `-1`). An `ns::name` token's raw is now the whole name as written, not only `name`._
- **#122** — `.pad(value, width [, fill])` to line up the columns of `.log` tables: on the left for a positive width, on the right for a negative one, as printf's `%-12s` (TODO 4.2). _`fill` is one character, space by default; a longer value is kept whole. `.log` separates its values with tabs, now said in REFERENCE.md._

## #30–#77: the code review fixes

- **Lexer/shared:**
    - end markers, unknown characters, unterminated strings and comments, malformed numbers, `.hex` raw text (#30–#37);
    - `getHex` negatives, `pushSignedNumber` 32-bit, `tokenize()` stream, dead code (#38–#40).
- **Directives:**
    - `.align` power of two, `.fill` count, `.repeat 0`, `.warning` once;
    - loops without scope;
    - string defined later, characters above 255 (#41–#47).
- **CPU (#48–#57):**
    - byte order, dead methods, typed mode info;
    - honest `null` operands per CPU (6502 and 6809 fixes), ARM little-endian (#56);
    - 6502 `LDA $12,Y`, `.b` / `.w` suffixes (#57).
- **Errors:**
    - `AsmError` with file/line/column, the source line and a caret, macro context;
    - no wrapping or prefixes, errors located at their token;
    - "first defined at", located warnings (#58–#68);
    - include chains (`included from …`) and `first defined here` notes, normalized include paths (#75).
- **CLI / build (#69–#73):**
    - self-contained `dist/tsasm` (js-yaml bundled), `pnpm install:cli` / `uninstall:cli`, cross-platform `build:cli` (#69);
    - every build bumps the patch version (#70);
    - pnpm 12 build settings in `pnpm-workspace.yaml` (#71);
    - output files: no crash on a missing directory, listing only when enabled (#72);
    - no crash on a missing, invalid or empty project file (#73).
- **Messages:** `.REPEAT` / `.FOR` with a symbol defined later (#76), `.DEFINE` on the last line (#77).
