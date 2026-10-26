# tsAsm — changelog

What was fixed or added since the code review (`tsAsm-code-review.md`), by PR, newest first.
Each entry keeps its number from `TODO.md`, where it was tracked (1.1, 2.5 #9…): the entries and the TODO refer to each other by these numbers.
The problem is described as it was before the fix, then the fix in _italics_.

## Assembler

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
