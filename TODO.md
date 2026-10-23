# tsAsm — what's left to do

Gathered on 2026-10-22/23 while fixing the code review (`tsAsm-code-review.md`, PRs #30–#68).
Every repro below was re-checked on the code of #68.

## How we work

- **One small PR per fix.** Keep unrelated findings out of it: list them as follow-ups.
- **Behaviour and design choices are the maintainer's** (error vs warning, accepted ranges, semantics): ask, with options and a recommendation, before deciding.
- For each fix:
  - reproduce on `main` first;
  - show a `main` vs PR table in the PR;
  - check that the new tests fail on `main`;
  - keep `tsc` at 0 errors and lint unchanged (18 warnings).
- **Explicit, always:** something the assembler doesn't understand is an error, never silently ignored or truncated.
- **Loops (`.repeat`, `.for`) are line generators, like the C preprocessor, not scopes:** what the body defines stays where the loop is, and only the iterators are local. Macros do have a scope per call.
- **Errors:**
  - throw `AsmError.at(message, token)` when a token is at hand, else a plain `Error` (the assembler locates it at the statement);
  - messages say *what* is wrong, never "on line N";
  - warnings go through `assembler.warn()` / `runtime.warn()`.
- **Checking the CLI:** build it with `pnpm exec rollup -c rollup.config.js --environment TARGET:cli` (`pnpm build:cli` bumps the version since #70), then run `node dist/tsasm proj.yaml` on a small project.
- **`pnpm-workspace.yaml` is committed** since #71: it holds the pnpm 12 `allowBuilds` settings.
- **Done items stay in this file:** mark them `✅ **DONE (#PR)**` at the start of the item (and of the section title when the whole section is done), never delete them.

## 1. Bugs

### 1.1 Macros forget their symbols between the passes
A macro call's scope is deleted after pass 1, so pass 2 doesn't know the body's symbols yet when it needs them:

| Source | Result |
|---|---|
| `.macro m` / `beq skip` / `nop` / `skip:` / `.end` / `m` | `Undefined symbol 'SKIP'.` (pass 2) |
| `.macro m` / `k .equ 1` / `.db k` / `.end` / `m` | `Unknown symbol "@@macro_M_5__::K".` |
| a `.define` block in a macro body | `assignVariable: Unknown symbol "@@macro_M_7__::X".` |

Likely fix: keep each call's scope from pass 1 for pass 2. Scope names are already unique per call (`@@macro_<name>_<call line>__`), and `restoreAndPushScope` / `savedSymbols` exist (used by `.function`).

### 1.2 `.define` block inside `.repeat 1 { … }`
`.repeat 1 {` / `.define X` / `abc` / `.end` / `}` / `.db 1` → `Missing .END for the .DEFINE block.` The raw block isn't replayed correctly in a brace block. Check how `getBracedBlock` stores the `RAW_TEXT` token.

### 1.3 6502: no operand range checks (silent truncation)
`lda $12345` → `ad 45 23`, `lda #$1FF` → `a9 ff`, `lda ($1234),y` → `b1 34`. The 65C02 rejects these with `checkAddress` / `assertFitsInBytes`. Bring the same checks to the 6502, or do 2.1 first and get them for free.

### 1.4 Array literal indexing — ✅ DONE (#88)
✅ **DONE (#88)** — `.db [1,2][0]` → `Mismatched brackets in array literal.` (indexing a *named* array works).

*The indexing worked: the comma inside the brackets cut the `.db` value. The directives' values (`.db`, `.dw`, `.text`, `.let`…) and the `.fill` / `.align` arguments are now only split at the commas outside `( )` and `[ ]`: `.fill .iif(1,2,3), $AB` failed too. Strings no longer count as brackets: `.db "(", 1` and `.db "["` failed.*

Follow-ups found while doing it:
- **Macro call arguments** are still split at a comma inside `[ ]`: `m [1,2][1]` → `Macro 'M' expects 1 argument, but got 2.` (`macro/handler.ts`, both call forms). Without parentheses, `m ($12,x)` is also split in two. Decision needed: should `( )` group a macro argument too?
- ✅ **DONE (#89)** — `.db [1,2]` (a whole array) → `Unexpected object value 1,2.` Decision needed: emit its elements, or a clear error. *An error, decided: `[1,2]` doesn't say it means its elements. Now `.DB value: an array can't be emitted as is: index it to emit one of its elements.` (or `an object … use one of its fields`), at the value. An array defined after the `.db` was silently emitted as nothing (`.db t` / `t = [1,2]`): it's the same error now.*
  - ✅ **DONE (#90)** — **Spread, decided:** `.db 1, ...table, 2` emits each element as if written there (strings too), in `.db` / `.dw` / `.dl` and probably `.text`. `...` is already the lexer's `REST_OPERATOR`, as in macro rest parameters. The array error then adds "or spread it". *Done in `.db` / `.dw` / `.dl` and the string directives (`.text`, `.cstr`, `.pstr`, `.pstrl`), a macro's rest parameter included. The array must be known in pass 1: an array defined later is an error, like a string. Spreading in a macro call (`m(...list)`) isn't supported.*
- Indexing a macro's rest parameter gives the argument's tokens, not its value: in `.macro m(...a)`, `.db a[1]` → `an array can't be emitted as is`. `.for f of a` and `...a` evaluate them.
- Indexing an array defined later fails in pass 1: `.db t[1]` / `t = [2,3]` → `Attempted to index a non-array value.` The evaluator should pass `null` (not known yet) through `[ ]` in pass 1, as for 1.5.
- `getExpressionTokens`' `inParentheses` parameter is never used.

### 1.5 String operator with a symbol defined later
`.text "a" + msg` with `msg` defined later → `Binary operator '+' requires two strings.` The evaluator should pass `null` (not known yet) through string operators in pass 1. The string directive then reports "must be defined before it is used".

### 1.6 `.option local_label_char` takes effect one line late
`.option local_label_char "@"` / `:` / `nop`: the line after the `.option` was already lexed with the old prefix, so `:` is still accepted.

### 1.7 Small messages — ✅ DONE (#76, #77)
- ✅ **DONE (#76)** — `.repeat n` with `n` defined later → `.REPEAT count: null isn't a whole number (0 or more).` It should say the count must be defined before the `.REPEAT`, as the string directives do. *Now `.REPEAT: 'N' must be defined before it is used here (the count is needed to place what follows).` `.for x of list` had the same bug (it crashed with `object null is not iterable`) and is fixed too.*
- ✅ **DONE (#77)** — `.define X` on the last line (no newline) → `Syntax Error - Unexpected token in .DEFINE`, which is misleading. *Now `Missing .END for the .DEFINE block.` `.define X FROM "file"` on a last line, which was rejected, works too.*

### 1.7b Found while doing #75
- **Definition columns:** what a directive defines (`.macro`, `.equ`, `=`, `.let`, `.define`, `.function`, loop iterators) records the directive name's column, after the `.`, while errors point at the statement's start. A redefinition shows `1:2` for the error and `1:3` for its `first defined here` note. Record the statement's position (`Assembler.currentStatement`, added in #75).
- `.macro m {` without parameters → `Unexpected token in the macro parameter list.`
- `lda #` (no operand) is accepted silently.
- **No include guard:** a file defining macros can't be included by two modules (`Macro … redefined`). Decision needed: `.include once`, an automatic once-only include, or `.ifdef` / `defined()`.
- An `.include` inside a macro body gets an `included from file:4.2:…` line (the macro's "call.body" line number).
- **Missed by #75:** `.define` has its own redefinition check, `Cannot redefine symbol 'X' (first defined at …)` (`define.directive.ts`): still the old message, without the `first defined here` note and its include chain.
- `.define` without a name → `Syntax error - Expecting IDENTIFIER ` (trailing space, and it should say a symbol name is needed).

## 2. Code review, items left

### 2.1 CPU back-ends
- **6502 / 65C02 duplication** (architecture #3): about 600 lines nearly copied, with `selectAddressMode`, `rejectSuffix` and the suffix code now in both. Make `Cpu65C02Handler extends Cpu6502Handler`. This also fixes 1.3.
- **6809:**
  - `LBRA` / `LBSR` emitted with a `$10` page-2 prefix (`10 16 …`, should be `16 …`), and their size differs between the passes;
  - negative indexed offsets, `#-1` and backward `,PCR` throw (unsigned `pushNumber`);
  - `0,X` emits the 8-bit form instead of `84`;
  - no `<` / `>` direct/extended override, no `SETDP`;
  - many instructions missing (`CMPX CLR INC DEC TST TFR EXG ANDCC ORCC LDS …`, indirect `[,X]`);
  - `PSHS` / `PULS` may map both `U` and `S` to `$40` (unverified).
- **Unknown mnemonics silently become labels**, emitting nothing (architecture #8): 6809 `SWI RTI MUL SYNC DAA SEX`, 65C02 `STP WAI`, RV32I `ECALL EBREAK FENCE`. Decision needed: require `:` for labels, or warn when a "label" alone on its line looks like a mnemonic.
- **65C02:** missing `BBR` / `BBS` / `RMB` / `SMB`.
- **RV32I:**
  - `SRAI` encoded as `SRLI` (funct7 ignored);
  - no range or alignment checks on the B/J/I/S/U immediates (an out-of-range branch becomes branch-to-self);
  - no pseudo-ops (`li la mv j ret call nop`), no `%hi` / `%lo`;
  - `JALR ra,0(t0)` rejected.
- **ARM** is a two-instruction stub (`MOV #imm`, `B`). `#256` gives `#0`. Don't advertise it, or complete it.
- **Done this session:** 6502 `LDA $12,Y` (#57), `.B` / `.W` suffixes (#57), ARM byte order (#56).

### 2.2 Linker
- ✅ **DONE (#84)** — **Linker errors aren't located:** `link()` doesn't use `AsmError`. Messages like `Syntax error in line N` and the linker's `.SEGMENT()` / system variable errors still carry their line. Give `link()` the same mechanism: `toAsmError`, statement token, file.

  *The assembler's locating code is now shared (`ErrorLocator`): a linker error or warning is located at its token, else at its statement, in the script or included file, through macro calls, with the source line. The messages no longer carry their line.*
- ✅ **DONE (#87)** — A write past the end of a fixed segment is accepted. Through a linker script it gives `RangeError: Invalid array length`. *A write that starts in a fixed segment and goes past its end is now an error at its line: `Write out of bounds: address $804 outside fixed segment 'SEG' …`, as one that starts past it already was.*
  - ✅ **DONE (#86)** — `.OUTPUT … FIXED n` too large fails the same way before the friendly check. *Now `Output file is too large. Max size is n bytes, …`.*
- ✅ **DONE (#86)** — `.SECTION x AT off` is misplaced when the output isn't fixed. `.WRITE WORD/LONG … AT` writes one element (truncated). `STRING` / `BYTES` ignore `AT`. *Every `AT` write is now applied like a section: in order, over the complete output, padded up to it when it isn't `FIXED`. `WORD` / `LONG` follow `.ENDIAN`, and `.PC` in a section is its offset in the output. A negative offset is an error. The directive's file is now `section.directive.ts`.*
- `link()` isn't idempotent.
- ✅ **DONE (#80)** — `linker_script.md` still describes jsasm6502-era syntax. *Rewritten from the current code, each behaviour checked with a script, with a Limitations section.*
- ✅ **DONE (#80)** — `;` isn't a comment in a linker script (`Unexpected character ';'`). *By design: it tells a linker script from assembler source. Now documented.*
- ✅ **DONE (#79)** — In a linker script, `.ENDIAN BIG` changes `.WRITE WORD/LONG` but not `.WORD`, `.LONG` or the length of `.PSTRINGLONG`, which stayed little-endian. *They now follow `.ENDIAN`.*
- ✅ **DONE (#83)** — A `.WRITE` value isn't parsed unless it's a number, a string or a symbol name. Parentheses are needed:
  - `.WRITE SEGMENT s.name` → `Invalid syntax: '.' must be followed by an identifier.`
  - `.WRITE BYTE .lobyte($1234)` → `Unknown system variable: LOBYTE`
  - `.WRITE BYTES [1, 2]` → `Mismatched brackets in array literal.`
  - `.WRITE SEGMENT(s.name)`, `.WRITE BYTE(.lobyte($1234))`, `.WRITE BYTES([1, 2])` work.

  *The value now runs to the end of the line or to `AT`: both syntaxes work. A missing value is an error.*
- `.segment("CODE").size` → `Unknown system variable: SIZE`: a field of a function's result can't be read directly. `seg = .segment("CODE")` then `seg.size` works. Check if the assembler's `.segment()` does the same.
- The assembler's `.module` (`module.directive.ts`; it groups segments for the linker's `.WRITE MODULE`) always fails when the project file defines segments → `Segments were used before any module was defined.` The first project segment is selected before the source starts (`polyasm.ts:191`), which puts it in the implicit `__MAIN__` module. Modules only work with segments defined in the source.
- ✅ **DONE (#87)** — `.WRITE SEGMENT` / `.WRITE MODULE` in a `.SECTION … AT` silently go to the end of the output, not to the section. With `.OUTPUT "x" FIXED 4`, `.SECTION S AT 2`, `.WRITE SEGMENT "CODE"` puts `CODE` at 0. Either write them to the section or make it an error. They ignore `.WRITE … AT` too. *They now go to the section, and take `AT`, like the other writes. A fixed segment is padded to its size.*
- One skipped linker test: the hybrid `SEGMENTS` variable (the maintainer didn't remember what it held).
- ✅ **DONE (#85)** — The linker prints a debug `Linker` / `- CODE offset: …` after each run (`console.log` in `linker.class.ts`). *It goes to the listing now, with the linker script's report and `.log`s, when `output.listing.linker` is on (`log.linkerEnabled` for the library). Off by default: the console only shows warnings and errors.*

### 2.3 CLI
- Relative config path applied twice (`chdir` + `dirname`), so `tsasm proj/conf.yaml` fails.
- ✅ **DONE (#69, #73)** — The config validator crashes on `cpu: 6502` and on an empty file. *A missing file and YAML syntax errors are reported too, as `file:line:column: error:`.*
- ✅ **DONE (#72)** — An empty `.lst` is always created in the current directory. *The listing is only written when enabled, relative to the project file, its directory created; a write failure is a clean error, not a node crash.*
- ✅ **DONE (#75)** — Included file paths come out as `./././nope.asm`. *Now normalized (`includes/x.asm`), and every error in an included file says through which includes it was reached.*

### 2.4 Build
- ✅ **DONE (#69)** — `build:cli` / `build:lib` are broken on macOS/Linux. *Now `rollup --environment TARGET:…`.*
- **Package unpublishable:**
  - `main` / `bin` point to `tsasm.js`, which isn't in `dist/`;
  - `publishIt` has no `dist/package.json`;
  - the bin is named `asm6502`;
  - no `files` / `exports` / `types` / `engines`;
  - `.d.ts` files are emitted for the tests.
- Type errors don't fail the build, and CI doesn't run `check` / `build`.
- `tsconfig`: `moduleResolution: node` and `esModuleInterop: false` are deprecated in TS 6. Use `"bundler"`.

### 2.5 Architecture
- **#1, two hand-copied passes:** `passOne` / `passTwo` and most directives' `handlePassOne` / `handlePassTwo` re-implement parsing separately. Suggested: one pass loop parametrised by the pass, each directive and instruction exposing `size()` and `emit()` from the same evaluation, and iterating until stable (max N passes) instead of reporting a phase error when a forward reference changes a size. Big: plan it first.
- **#5, global mutable state:** module-level `blockDirectives` / `rawDirectives` are mutated by `register()`, so the linker's `SECTION` leaks into every parser.
- **#6, god objects:** `Assembler` exposes parser, linker and symbol table as public mutable fields and is passed whole to some directives, while others get `DirectiveRuntime`. `Linker` is a segment store, a DSL interpreter and an output image.
- **#9:** the lexer decides unary minus from `lastToken`. That belongs in the expression parser.
- **#10, dead code:**
  - ~15 never-emitted token types;
  - commented-out blocks;
  - `isVolatileScope` / `restoreAndPushScope` (check);
  - tests asserting buggy behaviour (e.g. "integer division" expecting `13/4` as a fraction).
- **#11, test gaps:**
  - an "assemble twice, compare pass sizes" harness would catch the whole phase-error class;
  - CLI exit codes;
  - multi-pass stability.
- 7 tests are skipped: review them (`.UNDEF()`, `.FUNCTION` scoping, hybrid segments…).

## 3. Done this session (for reference)
- **Lexer/shared:**
  - end markers, unknown characters, unterminated strings and comments, malformed numbers, `.hex` raw text (#30–#37);
  - `getHex` negatives, `pushSignedNumber` 32-bit, `tokenize()` stream, dead code (#38–#40).
- **Directives:**
  - `.align` power of two, `.fill` count, `.repeat 0`, `.warning` once;
  - loops without scope;
  - string defined later, characters above 255 (#41–#47).
- **CPU:**
  - byte order, dead methods, typed mode info;
  - honest `null` operands per CPU (6502 and 6809 fixes), ARM little-endian;
  - `.b` / `.w` suffixes (#48–#57).
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
