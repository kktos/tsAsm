# tsAsm — what's left to do

Gathered on 2026-10-22/23 while fixing the code review (`tsAsm-code-review.md`, PRs #30–#68).
Every repro below was re-checked on the code of #68.
What is done is in `CHANGELOG.md`. How we work (PR rules, design rules, commands) is in `CLAUDE.md`.

## 1. Bugs

### 1.3 6502: no operand range checks (silent truncation)

`lda $12345` → `ad 45 23`, `lda #$1FF` → `a9 ff`, `lda ($1234),y` → `b1 34`. The 65C02 rejects these with `checkAddress` / `assertFitsInBytes`. Bring the same checks to the 6502, or do 2.1 first and get them for free.

### 1.31 A `{ }` block in a macro body closed by `.end`

`.macro m` / `.repeat 2 {` / `nop` / `}` / `.end` / `m` → `Missing .END for the .MACRO block.` Same with `.function f {`. It works in a `.macro m { … }` body, and with the `.end` form of the inner block.

### 1.35 A trailing comma in `.fill` / `.align`

`.fill 2,` → `00 00`, `.align 4,` → `00 00 00`: an empty filler is 0, as when there's no filler at all.

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
- 7 tests are skipped: review them (`.UNDEF()`, `.FUNCTION` scoping, hybrid segments…).

## 4. Features (ideas)

### 4.1 Default values for macro parameters

As in JavaScript: `.macro m x, y = 2, z = 3`. Parameters with a default come last, after those without one, and are filled from the first: `m 1` gives `y = 2, z = 3`, `m 1, 5` gives `z = 3`. An argument can still not be empty (`m 1,,4` stays an error, see 1.23 in `CHANGELOG.md`).

_Decided: an omitted argument is as if its default had been written at the call. The default's tokens are injected in its place, so it's evaluated at each call, where the macro uses it, like any argument (as MASM's `:=` and NASM's defaults do; not once at the definition, as Python does). Evaluating at the definition would break forward references in pass 1 (`y = BUFFER_END` defined later), and Python's surprise (one mutable default shared by the calls) doesn't apply to these values._

- A default can use the parameters before it, as in JavaScript: `y = x*2`. They are substituted into its tokens with `substituteArgs`, as for a nested call. Using a later parameter is an error.
- A default in `< >` is text, like a text argument: `y = <#5>`.
- At the definition, only the form is checked: defaults come after the parameters without one, and the rest parameter has none. Nothing is evaluated there.
- A default that changes between calls follows: with `count = 1`, `.macro m x = count`, `count = 2`, `m` gives 2. `x = *` is the address where `x` is used, so `.dw x, x` gives two addresses, as an explicit `m *` already does.
- To note in REFERENCE.md: a default's symbols are resolved inside the macro, so a local of the body with the same name takes the place of the outer symbol. Explicit arguments already behave this way.
