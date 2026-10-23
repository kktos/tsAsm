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
  - keep `tsc` at 0 errors and lint unchanged (16 warnings).
- **Explicit, always:** something the assembler doesn't understand is an error, never silently ignored or truncated.
- **Loops (`.repeat`, `.for`) are line generators, like the C preprocessor, not scopes:** what the body defines stays where the loop is, and only the iterators are local. Macros do have a scope per call.
- **Errors:**
  - throw `AsmError.at(message, token)` when a token is at hand, else a plain `Error` (the assembler locates it at the statement);
  - messages say *what* is wrong, never "on line N";
  - warnings go through `assembler.warn()` / `runtime.warn()`.
- **Checking the CLI:** build it with `TARGET=cli npx rollup -c rollup.config.js` (the `build:cli` script is Windows-only), then run `node dist/tsasm proj.yaml` on a small project.
- **Don't commit `pnpm-workspace.yaml`:** running pnpm creates it.

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

### 1.4 Array literal indexing
`.db [1,2][0]` → `Mismatched brackets in array literal.` (indexing a *named* array works).

### 1.5 String operator with a symbol defined later
`.text "a" + msg` with `msg` defined later → `Binary operator '+' requires two strings.` The evaluator should pass `null` (not known yet) through string operators in pass 1. The string directive then reports "must be defined before it is used".

### 1.6 `.option local_label_char` takes effect one line late
`.option local_label_char "@"` / `:` / `nop`: the line after the `.option` was already lexed with the old prefix, so `:` is still accepted.

### 1.7 Small messages
- `.repeat n` with `n` defined later → `.REPEAT count: null isn't a whole number (0 or more).` It should say the count must be defined before the `.REPEAT`, as the string directives do.
- `.define X` on the last line (no newline) → `Syntax Error - Unexpected token in .DEFINE`, which is misleading.

### 1.8 CLI
- Included file paths come out as `./././nope.asm`.
- The linker prints a debug `Linker` / `- CODE offset: …` after each run (`console.log` in `linker.class.ts`).

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

### 2.2 Linker / CLI / build
(A `fix/cli-conf-errors` branch exists: check what it already covers.)
- **Linker errors aren't located:** `link()` doesn't use `AsmError`. Messages like `Syntax error in line N` and the linker's `.SEGMENT()` / system variable errors still carry their line. Give `link()` the same mechanism: `toAsmError`, statement token, file.
- Relative config path applied twice (`chdir` + `dirname`), so `tsasm proj/conf.yaml` fails.
- The config validator crashes on `cpu: 6502` (a YAML number, `toUpperCase` TypeError) and on an empty file.
- A write past the end of a fixed segment is accepted. Through a linker script it gives `RangeError: Invalid array length`. `.OUTPUT … FIXED n` too large fails the same way before the friendly check.
- `.SECTION x AT off` is misplaced when the output isn't fixed. `.WRITE WORD/LONG … AT` writes one element (truncated). `STRING` / `BYTES` ignore `AT`.
- `link()` isn't idempotent. An empty `.lst` is always created in the current directory.
- **Build:** `build:cli` / `build:lib` are broken on macOS/Linux (`set TARGET=cli&&`). Use `rollup -c --environment TARGET:cli`.
- **Package unpublishable:**
  - `main` / `bin` point to `tsasm.js`, which isn't in `dist/`;
  - `publishIt` has no `dist/package.json`;
  - the bin is named `asm6502`;
  - no `files` / `exports` / `types` / `engines`;
  - `.d.ts` files are emitted for the tests.
- Type errors don't fail the build, and CI doesn't run `check` / `build`.
- `tsconfig`: `moduleResolution: node` and `esModuleInterop: false` are deprecated in TS 6. Use `"bundler"`.
- `linker_script.md` still describes jsasm6502-era syntax.
- One skipped linker test: the hybrid `SEGMENTS` variable (the maintainer didn't remember what it held).

### 2.3 Architecture
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
  - "first defined at", located warnings (#58–#68).
