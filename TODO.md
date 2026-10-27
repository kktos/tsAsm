# tsAsm — what's left to do

Gathered on 2026-10-22/23 while fixing the code review (`tsAsm-code-review.md`, PRs #30–#68).
Every repro below was re-checked on the code of #68.
What is done is in `CHANGELOG.md`. How we work (PR rules, design rules, commands) is in `CLAUDE.md`.

## 1. Bugs

### 1.3 6502: no operand range checks (silent truncation)

`lda $12345` → `ad 45 23`, `lda #$1FF` → `a9 ff`, `lda ($1234),y` → `b1 34`. The 65C02 rejects these with `checkAddress` / `assertFitsInBytes`. Bring the same checks to the 6502, or do 2.1 first and get them for free.

### 1.31 A `{ }` block in a block closed by `.end`

`.macro m` / `.repeat 2 {` / `nop` / `}` / `.end` / `m` → `Missing .END for the .MACRO block.` Same with `.proc f {`, and in an `.if` / `.elseif` / `.else` branch: `.if 0` / `.repeat 2 {` / `nop` / `}` / `.end` → `Missing .END for the .IF block.` It works in a `.macro m { … }` body, and with the `.end` form of the inner block.

### 1.35 A trailing comma in `.fill` / `.align`

`.fill 2,` → `00 00`, `.align 4,` → `00 00 00`: an empty filler is 0, as when there's no filler at all.

### 1.37 Fractions truncated silently

`/` gives fractions (`7 / 2` is `3.5`), and where a whole number is needed they are truncated without a word: `lda #7/2` → `a9 03`, `.dw 1000/3` → `4d 01`, `.org $1000 + 1/2` is accepted, `.if 1/2` is true. `.repeat 5/2` already says `isn't a whole number`, and `l[3/2]` gives `Unexpected value type undefined.` Error or warning, and what `.if` does with a fraction: decision needed (recommended: an error, as `.repeat` does). See 3.6.

### 1.38 Unknown escape sequences

`"\0"` → `30`, `"\q"` → `71`: an unknown escape gives the char after the backslash. It should be an error. `\0` is an idea in 4.7.

### 1.41 A macro's or a function's labels end the caller's local label scope

`start:` / `:l nop` / `m` / `jmp :l`, with `.macro m` / `lbl: nop` / `.end` → `Undefined local label ':l' in scope 'LBL'`, though `LBL` is local to the macro call. Same with a label in a `.proc` body: a `:l` before `.proc f` / `x: rts` / `.end` isn't found after it (that one may be wanted: decide).

### 1.47 Unknown directives in other blocks not assembled

Since #150, a branch of `.if` not taken rejects an unknown directive starting a statement. Other blocks that aren't assembled still don't: `.repeat 0` / `.foobar` / `.end` and a macro never called with `.foobar` in its body assemble. In a branch not taken, a label without a colon before the directive isn't seen as a statement start (`lbl .foobar` passes, `lbl: .foobar` doesn't): telling it from an instruction's operand (`jmp .pc`) needs the CPU's mnemonics and the macros.

### 1.50 `.list on` lists pass 1 when only pass 2 is asked

With `output.listing: { enabled: true, passes: { pass2: true } }`, the statements after a `.list on` are also listed in pass 1, before the pass 2 header, with pass 1 values (`.db "<1 bytes>"`, `.fill "<4 bytes>"`, `1006: 00  NOP`). `.list on` should only turn back on the passes the project file lists.

### 1.51 `listing: { enabled: true }` alone writes an empty listing

Without a linker script, `output.listing: { enabled: true }` writes a `.lst` holding only `--- Assembly Complete ---`. It needs `passes: { pass2: true }` to list anything. Pass 2 should be listed by default, as README's example (`listing: enabled: true`) implies. With a linker script and `linker: true` (the conan game) pass 2 is listed.

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

### 2.2 Linker

- `link()` isn't idempotent.
- `.segment("CODE").size` → `Unknown system variable: SIZE`: a field of a function's result can't be read directly. `seg = .segment("CODE")` then `seg.size` works. Check if the assembler's `.segment()` does the same.
- The assembler's `.module` (`module.directive.ts`; it groups segments for the linker's `.WRITE MODULE`) always fails when the project file defines segments → `Segments were used before any module was defined.` The first project segment is selected before the source starts (`polyasm.ts:191`), which puts it in the implicit `__MAIN__` module. Modules only work with segments defined in the source.
- One skipped linker test: the hybrid `SEGMENTS` variable (the maintainer didn't remember what it held).

### 2.4 Build

- **Package unpublishable:**
    - `main` / `bin` point to `tsasm.js`, which isn't in `dist/`;
    - `publishIt` has no `dist/package.json`;
    - the bin is named `asm6502`;
    - no `files` / `exports` / `types` / `engines`;
    - `.d.ts` files are emitted for the tests.

### 2.5 Architecture

- **#1, two hand-copied passes:** `passOne` / `passTwo` and most directives' `handlePassOne` / `handlePassTwo` re-implement parsing separately. Suggested: one pass loop parametrised by the pass, each directive and instruction exposing `size()` and `emit()` from the same evaluation, and iterating until stable (max N passes) instead of reporting a phase error when a forward reference changes a size. Big: plan it first.
- **#6, god objects:** `Assembler` exposes parser, linker and symbol table as public mutable fields and is passed whole to some directives, while others get `DirectiveRuntime`. `Linker` is a segment store, a DSL interpreter and an output image.
- **#11, test gaps:**
    - an "assemble twice, compare pass sizes" harness would catch the whole phase-error class;
    - CLI exit codes;
    - multi-pass stability.
- 7 tests are skipped: review them (`.UNDEF()`, `.PROC` scoping, hybrid segments…).

## 3. Syntax: design questions

Found on 2026-10-26 by reviewing README and REFERENCE against the code. Each needs a decision before a fix.

### 3.4 `.namespace` isn't a block

`.end` alone → `there's no block to end`, `.namespace n {` → `Unexpected token after the .NAMESPACE name.`, and `.namespace a` then `.namespace b` just switches. Either a real block (`.end`, braces, nesting) or a switch, documented as one (`.end namespace` going back to `global`).

### 3.5 Case of `.define` properties

Symbols ignore case, properties don't: with `{ Id: 5 }`, `d[0].Id` works but `d[0].id` and `d[0].ID` → `Property … does not exist on object.` Ignore case, or document it.

### 3.6 Fractions without literals

`/` gives fractions, but `1.5` → `Invalid syntax: '.' must be followed by an identifier.` Options: an integer `/`, as ca65; or keep fractions in expressions and reject them where they land (1.37). Recommended: the second.

### 3.7 Names

- `.define` is a text macro in ca65 and C; here it loads data.
- `.str` and `.hex` are directives and functions, `.segment` and `.namespace` directives and variables: `.str("A")` at the start of a line emits `41`.

Rename (keeping aliases), or document.

`.function` was a label scope, not a function usable in expressions: done in #142, it's `.proc` (see `CHANGELOG.md`).

### 3.8 Quoting of names

`.cpu "65C02"` needs quotes, `.segment BOOT` and `.module GAME` don't, and `.cpu 65C02` → `Invalid number '65C02'.` Accept a bare name, or at least a clearer message.

## 4. Features (ideas)

### 4.1 Default values for macro parameters

As in JavaScript: `.macro m x, y = 2, z = 3`. Parameters with a default come last, after those without one, and are filled from the first: `m 1` gives `y = 2, z = 3`, `m 1, 5` gives `z = 3`. An argument can still not be empty (`m 1,,4` stays an error, see 1.23 in `CHANGELOG.md`).

_Decided: an omitted argument is as if its default had been written at the call. The default's tokens are injected in its place, so it's evaluated at each call, where the macro uses it, like any argument (as MASM's `:=` and NASM's defaults do; not once at the definition, as Python does). Evaluating at the definition would break forward references in pass 1 (`y = BUFFER_END` defined later), and Python's surprise (one mutable default shared by the calls) doesn't apply to these values._

- A default can use the parameters before it, as in JavaScript: `y = x*2`. They are substituted into its tokens with `substituteArgs`, as for a nested call. Using a later parameter is an error.
- A default in `< >` is text, like a text argument: `y = <#5>`.
- At the definition, only the form is checked: defaults come after the parameters without one, and the rest parameter has none. Nothing is evaluated there.
- A default that changes between calls follows: with `count = 1`, `.macro m x = count`, `count = 2`, `m` gives 2. `x = *` is the address where `x` is used, so `.dw x, x` gives two addresses, as an explicit `m *` already does.
- To note in REFERENCE.md: a default's symbols are resolved inside the macro, so a local of the body with the same name takes the place of the outer symbol. Explicit arguments already behave this way.

### 4.4 Bitwise NOT `~`

`!5` is `0`, and `~` is an unexpected character: `mask ^ $FF` is the only way. `~` is also one of the chars `.option local.prefix` and `anon.marker` accept: as an operator, it would keep its meaning elsewhere, as `!` does.

### 4.5 A run address different from the load address

As ca65's `.org` in a relocatable segment, ACME's `!pseudopc` or 64tass's `.logical`: code assembled for one address, written at another (a zero page routine, a relocated loader). Today `.org` in a segment pads: `nop` / `.org $2000` in a segment at `$1000` writes 4K of zeros.

### 4.6 Character mapping

`.charmap` / `.encoding`, or at least a high-bit string directive. Apple II `COUT` expects high-bit chars: the README's `.cstr "HELLO"` doesn't print `HELLO`. One char at a time works since 1.40: `.db "H"|$80`.

### 4.7 Smaller ones

- `.assert <condition>, <message>`;
- `.struct` / `.enum`, for field offsets;
- leaving a macro early;
- `.for` over a numeric range;
- a `\0` escape.

### 4.8 User functions

Nothing computes a reusable value today: a macro is a statement and emits lines, and it can't set a variable for its caller (its variables are local to the call). So a formula is written again at each use (`sta $0400 + 5*40 + 10`). Uses: address formulas (screen, tiles, banks), packed values (colours, sprite pointers), generated tables (`.db reverse(i)` in a `.repeat`), checks (`.if !samePage(a, b)`), a char mapping (4.6). KickAssembler and 64tass have them; ca65 users fake them with `.define`.

Two forms, parentheses always written:

```as
; one line: one expression
.function screen(col, row) = $0400 + row*40 + col

; block: assignments, .if, .repeat / .for, .error, and .return
.function reverse(b) {
    r = 0
    .repeat 8 AS i {
        r = (r << 1) | ((b >> (i - 1)) & 1)
    }
    .return r
}

    sta screen(10, 5)
```

- **Arguments are values, evaluated at the call** (unlike a macro's, evaluated where the macro uses them).
- **A scope per call**, as for macros: the parameters and the body's variables are local to it.
- **Pure:** emitting, a label, `.org`, `.segment` or assigning an outer variable in the body is an error. Outer symbols and `*` can be read. It then gives the same result in both passes: no new phase errors.
- **Errors:** a block ending without `.return`; a recursion deeper than a limit.
- **Call:** `name(…)` in an expression, `ns::name(…)` from another namespace. System functions keep their dot, so they don't collide. Functions and symbols share their names: defining both is an error.
- **Migration** (3.7, done in #142): the routine scope is `.proc` / `.procedure`, and until user functions exist, `.function` / `.fn` are an error that says to write `.proc clearScreen`. With them, only the old form (no parentheses) will be.

Order: the one-line form (store the expression's tokens, evaluate them with the parameters in scope); the block form with `.return`. Helpful with it: `.min`, `.max`, `.abs`, `.sin`, `.cos`, `.chr`, `.ord`.

Decisions left: the bare `name(…)` call, the recursion limit.

### 4.9 Fold a `.repeat` in the listing

A generated table is listed one line per iteration: `.repeat 128 AS idx FROM 0` / `.db (idx % 16) * 16` gives 128 `.db` lines, where a `.hex` block of the same bytes is listed as a dump. An option to list a loop once, its header and then its bytes 16 per line: `.option listing.repeat "fold"` (or `"expand"`, today's behaviour), or `.list repeat fold`. Found in the conan game (`spritelib/tables.asm`, `spriteLo` / `spriteHi`). The workaround today, building a 16-value row in an array (between `.list off` / `.list on`, or every `row = .push(…)` is listed) then `.repeat 8` / `.db ...row`, is clumsier than the one-line loop it replaces.

### 4.10 Building an array without a loop

Building an array takes a loop of assignments (`row = .push(row, col * 16)`), each one listed. A built-in or an expression form would give it in one: `.range(start, count [, step])` with a `.map(array, function)` once user functions exist (4.8), or a comprehension, `[col * 16 for col in 0..15]`. Then `.db ...` emits it directly. Bigger than 4.9; decide the syntax with 4.8.

## 5. Documentation (REFERENCE.md)

- **Macro scope:** labels and variables in a macro body are local to the call. CLAUDE.md says it, REFERENCE doesn't.
- **`_` separator:** it works in hex and decimal too (`$FF_FF`, `1_000`); only binary is shown.
- **`<` / `>` on a value over 16 bits:** they give bits 0–7 and 8–15 (`>$12345` is `$23`).
- **`.proc` labels** can't be reached from outside (`f::loop` → `Undefined symbol`): say it, or add a way.
- **CPUs:** only the 65C02 is documented. The `.cpu` names and the 6809 and RV32I syntax aren't, and README's `input.cpu` lists `65C02` only.
- **Segment pad value:** `padValue` in the project file, `pad` in `.segment`. Document both, or unify.
