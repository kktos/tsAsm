# tsAsm — what's left to do

Gathered on 2026-10-22/23 while fixing the code review (`tsAsm-code-review.md`, PRs #30–#68).
Every repro below was re-checked on the code of #68.
What is done is in `CHANGELOG.md`. How we work (PR rules, design rules, commands) is in `CLAUDE.md`.

## 1. Bugs

### 1.31 A `{ }` block in a block closed by `.end`

`.macro m` / `.repeat 2 {` / `nop` / `}` / `.end` / `m` → `Missing .END for the .MACRO block.` Same with `.proc f {`, and in an `.if` / `.elseif` / `.else` branch: `.if 0` / `.repeat 2 {` / `nop` / `}` / `.end` → `Missing .END for the .IF block.` It works in a `.macro m { … }` body, and with the `.end` form of the inner block.

### 1.37 Fractions truncated silently

`/` gives fractions (`7 / 2` is `3.5`), and where a whole number is needed they are truncated without a word: `lda #7/2` → `a9 03`, `.dw 1000/3` → `4d 01`, `.org $1000 + 1/2` is accepted, `.if 1/2` is true. `.repeat 5/2` already says `isn't a whole number`, and `l[3/2]` gives `Unexpected value type undefined.` Error or warning, and what `.if` does with a fraction: decision needed (recommended: an error, as `.repeat` does). See 3.6.

### 1.41 A macro's or a function's labels end the caller's local label scope

`start:` / `:l nop` / `m` / `jmp :l`, with `.macro m` / `lbl: nop` / `.end` → `Undefined local label ':l' in scope 'LBL'`, though `LBL` is local to the macro call. Same with a label in a `.proc` body: a `:l` before `.proc f` / `x: rts` / `.end` isn't found after it (that one may be wanted: decide).

### 1.47 Unknown directives in other blocks not assembled

Since #150, a branch of `.if` not taken rejects an unknown directive starting a statement. Other blocks that aren't assembled still don't: `.repeat 0` / `.foobar` / `.end` and a macro never called with `.foobar` in its body assemble. In a branch not taken, a label without a colon before the directive isn't seen as a statement start (`lbl .foobar` passes, `lbl: .foobar` doesn't): telling it from an instruction's operand (`jmp .pc`) needs the CPU's mnemonics and the macros.

### 1.61 A braced `.if` in a keyword block

`.macro m` / `.if 1 { .db 0 }` / `.db 1` / `.end` → `Missing .END for the .MACRO block.`, same in a `.for` … `.end`. Reading the block, `getKeywordBlock` counts the `.if` as a block that needs its own `.end`, though its `{ }` already ended it. Found with `.exitmacro`.

### 1.62 A call in a loop header listed with a space

`.repeat sq(2) AS i` is listed `.repeat sq ($02) AS i`, and `.repeat .lobyte(2) AS i` is listed `.repeat . lobyte ($02) AS i`: `tokensText` spaces the tokens of a call, its dot and its `(`. Found with 4.8.

### 1.63 A `.macro` / `.function` definition listed in quotes

`.function sq(x) = x * x` is listed `.function "sq(x) = x * x"`, and `.macro m a` as `.macro "m(A)"`: the lister quotes the text it's given, as `.option`'s was (1.58). Found with 4.8.

### 1.64 A function's body is only read when it's called

`.function f(x) = x +* 2` or a body with `.retrun x` is an error only where `f` is called: a function never called, in a library, keeps its typo. The one-line form's expression could be parsed at the definition, without evaluating it, and a block's statements checked as a branch not taken is (`Parser.checkDirectives`). Found with 4.8.

### 1.66 A 6809 or RV32I branch to a fixed address in a relocatable segment

In a relocatable segment, the instruction's PC is its offset there: a branch to a fixed address is computed from it, silently. `.segment CODE { reloc: true }` / `nop` / `bra $10` → `12 20 0D` on the 6809; `beq x0, x0, $10` the same on the RV32I. The 65xx reads its branch targets with `OperandReader.branchTarget` since #181, which rejects them (`A branch from relocatable segment 'CODE' can't reach $10: …`); the other CPUs should too. Their operands don't take relocatable values (`the 6809's operands can't take one`): fixups for them would follow, RV32I's with `%hi` / `%lo` (2.1). Found with 4.19.

### 1.70 A label alone before an included file's assignment

`start:` / `.include "c.asm"`, with `c.asm` starting with `count = 3` → `c.asm:1:1: error: Syntax error - (Unknown opcode?) Unexpected label 'COUNT' after START`. `start:` / `count = 3` in one file assembles. Found with 4.28.

### 1.72 The 6809's `LBRA` and `LBSR` on page 2

`LBRA` and `LBSR` are in the 6809's page 2 with 3 bytes, but they're page 1 opcodes (`16`, `17`), 3 bytes: `.org $1000` / `lbra $1010` / `nop` → `10 16 00 0D 12`, four bytes with a page prefix, the offset computed for three. Found with 4.34.

### 1.75 A string as a condition

`.if` takes any value as JavaScript does (`Boolean(value)`): a string is true unless it's empty, so `.if "\x00"` is true, though a one-character string used as a number is its character code (#149), here 0, and `.if "AB"` is true, though a longer string is never a number. `.iif("A", 1, 2)` → `First argument to .IIF() must be a number.`: `.iif` doesn't convert a one-character string. How a condition reads a string, and an array or an object, to decide: as a number (recommended: a one-character string its code, anything else an error), or as true when not empty. Found with 1.74.

### 1.79 An `.align` of 2 GB or more

The padding is computed with a bit mask, `(PC + boundary - 1) & ~(boundary - 1)`, and JavaScript's `&` and `~` work on signed 32-bit numbers: from `$80000000`, a boundary gives a wrong address. On RV32I, `.db 1` / `.align $80000000` / `end:` → `Phase error: label 'END' is $80000000 in pass 1 but $1001 in pass 2.`, and the same at `$7FFFFFF0`, where it would pad 15 bytes; `.align $100000000` the same, `END` being `$00` in pass 1. To fix: the padding computed with arithmetic, not bits. Found with 1.78.

### 1.81 A macro call's variable has its pass-1 value in pass 2

A call's variables are its own, but in pass 2 the body reads the value its variable got in pass 1, not the caller's symbol it should read until it assigns the name: `count = 1` / `.macro m` / `count = count + 1` / `.db count` / `.end` / `m` → `03`, where a function's body gives 2 (REFERENCE.md says so for functions); `.db count` before `count = 5` in the body → `05`, not `01`. `count` stays 1 after the call, as it should. Found with 5.1.

### 1.82 Where a `_` can be in a number

`_` groups digits (5.2), and it's accepted anywhere after a number's prefix: `$_FF`, `0x_FF`, `$FF_`, `$F__F`, `1000_` and `1__000` are taken as `$FF` and `1000`, but `0b_1` → `Invalid number '0b_1'.` and `%_1010` → `Binary operator '%' requires two operands.` To decide: only between digits, the rest an error (recommended, as JavaScript does), or anywhere after the prefix. Found with 5.2.

### 1.83 A `.proc`'s variable has its pass-1 value in pass 2

As in a macro call (1.81): the body should read the symbol outside until it assigns the name, but in pass 2 it reads the value its own variable got in pass 1. `count = 1` / `.proc f` / `.db count` / `count = 5` / `.end` → `05`, not `01`. `count` stays 1 after the `.end`, as it should. Found with 5.4.

## 2. Code review, items left

### 2.1 CPU back-ends

- **6809:**
    - `LBRA` / `LBSR` emitted with a `$10` page-2 prefix (`10 16 …`, should be `16 …`), and their size differs between the passes;
    - negative indexed offsets, `#-1` and backward `,PCR` throw (unsigned `pushNumber`);
    - `0,X` emits the 8-bit form instead of `84`;
    - no `<` / `>` direct/extended override, no `SETDP`;
    - many instructions missing (`CMPX CLR INC DEC TST TFR EXG ANDCC ORCC LDS …`, indirect `[,X]`);
    - `PSHS` / `PULS` may map both `U` and `S` to `$40` (unverified).
- **Unknown mnemonics silently become labels**, emitting nothing (architecture #8): 6809 `SWI RTI MUL SYNC DAA SEX`, RV32I `ECALL EBREAK FENCE`. Decision needed: require `:` for labels, or warn when a "label" alone on its line looks like a mnemonic.
- **RV32I:**
    - `SRAI` encoded as `SRLI` (funct7 ignored);
    - no range or alignment checks on the B/J/I/S/U immediates (an out-of-range branch becomes branch-to-self);
    - no pseudo-ops (`li la mv j ret call nop`), no `%hi` / `%lo`;
    - `JALR ra,0(t0)` rejected.
- **ARM** is a two-instruction stub (`MOV #imm`, `B`). `#256` gives `#0`. Don't advertise it, or complete it.

### 2.2 Linker

- `link()` isn't idempotent.
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

Apple II `COUT` expects high-bit chars: the README's `.cstr "HELLO"` doesn't print `HELLO`. One char at a time works since 1.40: `.db "H"|$80`. The previous version of this assembler had `.option charmap <name>`, the table declared with `.define charmap_<name>`; the same, without the prefix:

```as
.define apple2
[
    0x00, 0x01, …,      ; $00-$1F unchanged
    0xA0, 0xA1, …,      ; $20-$7F: high bit set
    0x80, 0x81, …       ; $80-$FF unchanged
]
.end

.option charmap apple2
    .text "ABC"         ; C1 C2 C3
    cmp #"A"            ; C9 C1
.option charmap none
```

- **The value is an array symbol,** from `.define`, a literal or a loop: nothing is special about its name. It is defined before the `.option`, as for `...`. `none` turns the mapping off (the default).
- **Checked at the `.option`:** an array of 256 whole numbers, 0 to 255; anything else is an error there.
- **Where a character becomes a byte, never on a string value:** the string directives (`.text`, `.cstr`, `.pstr`, `.pstrl`), strings in `.db` / `.dw` / `.dl`, and a one-char string used as a number (`lda #"A"`), so `cmp #"A"` matches what `.text "A"` emitted. String comparisons, `+`, `.len`, `.split`, … see the text. `"9"-"0"` goes through the map too.
- **A local option** (`repeat.start`'s kind): each file decides, an include starts with the assembler's value, and a macro body uses the map of where it's defined. A library's strings don't change with its includer; a macro meant to follow its caller takes the map as a parameter.

Follow-ups: a function as the value, with 4.8 (`.function apple2(c) = c | $80`, then `.option charmap apple2`); partial maps (an object, `{ "A": 0xC1 }`, or ranges as 64tass's `.cdef`), where a character with no entry is an error; the raw code of a char while a map is on (`.ord()`, 4.8).

### 4.7 Smaller ones

- `.struct` / `.enum`, for field offsets;
- `.continue`, to go to a loop's next iteration (`.break` ends the loop), as 64tass's;
- a `\0` escape;
- `.min`, `.max`, `.abs`, `.sin`, `.cos`, `.chr`, `.ord`: system functions to write user functions with (4.8).

### 4.14 Project file settings on the command line

After 4.13: change any project file setting for one run, e.g. turn a pass's listing on (`output.listing.pass2`, `output.listing.pass1`), or pick another `input.cpu`. To decide: the syntax (`--output.listing.pass2 true`, with the setting's path?), how a value gets its type (from the schema in `conf.ts`), how these names stay apart from the `.option` ones and their short names, and short forms for the usual ones (listing on).

### 4.18 65C816: direct page, absolute and long addressing

Long addressing is done in #212: the size from the value, `.b` / `.w` / `.l`, `jmp` / `jsr` in the program bank, forward references and relocatable values. What's left, the hints:

- **Hints, never encoding** (4.15 directives): `.dp <expr>` and `.dbank <expr>` say what D and DBR hold. They only let the assembler point out a shorter form: "`$2012` is in the direct page declared at …: `lda.b $12` is one byte shorter"; "`$7E2000` is in the data bank declared at …: `lda.w $7E2000` is one byte shorter". Without them, no hint. Their operand is a number: a relocatable value is an error, as where a number is (#180).
- **`.b` keeps the address's low byte** (#212), the offset in the direct page only when D is page-aligned: with another D, the hint gives the offset, `lda.b $11` for `$2012` with D at `$2001`.
- **Hints are reported** at a level of their own, not as warnings. On by default: there are none without `.dp` / `.dbank`, so writing one is already asking for them. `.option hints off` turns them off.

### 4.21 Segment attributes and symbols in the linker script

Steps 4 and 5 of the plan in 4.19: `seg.attrs` and `seg.relocs` are done in #182, `.symbol()` in #183.

- **Segment map:** the `output.segments` file doesn't write a segment's attributes.
- **`.export`:** if object files ever need it, a way for the source to choose which symbols a script sees. Today it sees them all.

### 4.22 Apple IIgs: OMF output (S16)

The script library `lib/omf.linker.asm` is done in #185: version 2.0 segments, LCONST, RELOC, INTERSEG, END.

- **Shipping the library:** today the user copies it next to their script. Once the package is publishable (2.4), it could ship with tsasm: embedded and included by a reserved name, or found on a search path.
- **Fixed segments:** an error in an OMF file. An absolute segment (its `start` as ORG) can come if needed.
- **Later:** the compact cRELOC (`$F5`) / cINTERSEG (`$F6`) and SUPER (`$F7`) records; DS (`$F1`) for a segment's trailing zeros; ExpressLoad.
- **File type:** S16 is ProDOS type `$B3`, a directory entry's field, not in the file: a disk image written by the script (as conan's), or an external tool (Cadius, AppleCommander).
- **To check:** the library's output against a known-good file (Merlin 16+ or ORCA/M output) and in an emulator: #185 checks it against the specification only.

### 4.23 Addresses over 16 bits: the PC's range

Before 4.18: the 65816 addresses 16 MB. The PC's range is done in #200: `CPUHandler.addressBits`, and leaving it is an error; a segment's range in #201, checked when it's selected; an instruction crossing a bank in #202, `CPUHandler.bankBits`; a segment's `banksize` in #203; the listing's addresses in #204; numbers over $FFFF in hex in #205; the output's size, `input.linker.maxSize`, in #206; `hexDump`'s addresses in #207. What's left:

- **A segment growing by megabytes:** see 4.37.

### 4.25 65816: the widths per `.proc`

After 4.16: the assembler reads the code in order, so a routine called with other widths than the code before it says so with `.a16`, `.i8`. To decide: whether a `.proc` saves the widths (and the mode) at its start and puts them back at its end, or declares them (`.proc f { a: 16 }`), or neither.

### 4.26 VS Code extension

The extension is done in #213, in `editors/vscode`: syntax colouring of `.asm` files, its grammar built from the CPUs' mnemonics (`CPUHandler.mnemonics`), and links on the paths of `.include`, `.incbin` and `.define … from`. Its errors in the Problems panel are done in #215 (4.27); what else the editor can know of a source is in 4.28–4.36. The linker scripts' own language, `.linker.asm`, is done in #247. What's left here:

- **Publishing** on the Marketplace, which needs a publisher account: today it's installed from a `.vsix`.
- **A linker script's errors:** the extension assembles a project without linking it, so a script's errors (`Segment 'NOPE' not found.`) are only the CLI's, not in the Problems panel. To decide: link after each assembly, without writing the output.

### 4.28 VS Code: go to a definition, and hover

Done in #216 for labels, constants, variables, local and anonymous labels, functions and their parameters, macros, through the library's `onSymbolReference`. What's left:

- **Namespaces and segments:** `gfx::` and `.segment CODE` aren't linked: neither keeps where it's defined (a namespace can be opened in several places, a segment comes from `.segment` or the project file).
- **Names the evaluator doesn't resolve as values:** the name in `.def(x)` / `.undef(x)`, a name a built-in function takes as an argument.
- **A file in no project** gets a text scan only.

### 4.37 Segments that keep statements, not bytes

The assembler writes every byte of a segment in memory, in a JavaScript array, before linking: a segment growing by megabytes fails. On a 32-bit CPU, `addi x0, x0, 0` / `.org $12345678` / `addi x0, x0, 0` in a resizable segment pads it up to `$12345678` → `Invalid array length`, a JavaScript error, with no segment or size. `.fill` stops at 1 MB since #239 (1.67), `.align`'s padding since #240 (1.78). An idea, from the object files: a segment keeps what to write (`.fill $100000, 0`, `.org`'s gap, an `.incbin`'s file), as an object file does, and the linker writes the bytes, as it writes the output. Until then, a check on how far `.org` moves a resizable segment could replace the JavaScript error: to decide with this.

### 4.38 Formatting in columns

Done in the VS Code extension in #241: labels, mnemonics, operands and comments in fixed columns, a block's body indented; the settings per project in `.editorconfig` in #243. A linker script, `.linker.asm`, is another language since #247 (4.26): it isn't formatted. What's left:

- **`tsasm fmt`:** the same layout from the CLI, see 4.39.

### 4.39 `tsasm fmt`: formatting from the CLI

The layout of the VS Code extension (4.38) from the command line, for a project without VS Code and for CI: `tsasm fmt` writes the files formatted, `tsasm fmt --check` changes nothing and fails when a file isn't formatted.

- **The same code:** `formatSource` (`src/vscode/format.ts`), the blocks it reads (`blocks.ts`) and the `.editorconfig` reader (`editorconfig.ts`) are free of the vscode module: they move to a folder of their own (`src/format`?), shared by the CLI and the extension, so the two give the same result.
- **The same settings:** `.editorconfig` (`indent_style`, `tab_width`, `indent_size`, the `tsasm_*` keys), else the defaults: the columns at 8 / 16 / 40, blocks indented; no VS Code settings. To decide: tabs or spaces, and their width, when `.editorconfig` doesn't say (tabs of 4, or an error?). An error in `.editorconfig` is an error of the command, with its file and line.
- **`--check`:** lists the files not formatted, and exits with a non-zero status; nothing is written. To decide: whether it also shows the lines that would change (a diff).
- **To decide, how it's called:** `tsasm fmt <files or folders…>` as a subcommand, while `tsasm <project-file>` assembles (a project file named `fmt` would need `./fmt`), or an option, `tsasm --fmt`.
- **To decide, what it formats:** the files named, the `.asm` files of the folders named (but the linker scripts, `*.linker.asm`, see 4.26), or a project's sources (`tsasm fmt game.yaml`: the main source and the files it includes, as the assembly reads them).
- **To decide, labels and statements:** the extension knows the CPU and the macros from the last assembly. The CLI could assemble the project too, or read the files only: the mnemonics of the `input.cpu` of a project file, or of every CPU, the `.cpu` lines, the macros the files define with `.macro`. A word it can't tell keeps its side, as in the extension.
- **Linker scripts:** a `.asm` link script is formatted as a source (4.38). The CLI could leave the project's `input.linker.script` out, which a project names.
- **To check:** a file's line endings and byte order mark kept, a file not written when nothing changes (its date kept), the exit status when a file can't be read.

### 4.41 A project symbol's line

A constant of `input.symbols` (4.40) is located at the project file without a line: `;conan.yaml` in the `.sym` file, `conan.yaml: note: defined here` for a redefinition, and the VS Code extension's go to definition opens the project file at its first line. js-yaml 5 doesn't give a key's position: the CLI would find the key's line in the text, as the extension's `keyLine` does for the schema's errors (`src/vscode/analysis.ts`), for a block mapping and a flow one (`symbols: { DISK_KB: 800 }`). The `.sym` line then gets its `:line:column` back, which the debugger reads.

## 5. Documentation (REFERENCE.md)

### 5.5 CPUs

Only the 65C02 is documented. The `.cpu` names and the 6809 and RV32I syntax aren't, and README's `input.cpu` lists `65C02` only.

### 5.6 Segment pad value

`padValue` in the project file, `pad` in `.segment`. Document both, or unify.
