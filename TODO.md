# tsAsm — what's left to do

Gathered on 2026-10-22/23 while fixing the code review (`tsAsm-code-review.md`, PRs #30–#68).
Every repro below was re-checked on the code of #68.
What is done is in `CHANGELOG.md`. How we work (PR rules, design rules, commands) is in `CLAUDE.md`.

## 1. Bugs

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

### 1.58 `.option` listed with its quotes inside quotes

`.option listing.case "lower"` is listed `.option "listing.case = "lower""`: `setOption` lists the name and the value as one string, and the lister quotes it. Found with 4.9.

### 1.61 A braced `.if` in a keyword block

`.macro m` / `.if 1 { .db 0 }` / `.db 1` / `.end` → `Missing .END for the .MACRO block.`, same in a `.for` … `.end`. Reading the block, `getKeywordBlock` counts the `.if` as a block that needs its own `.end`, though its `{ }` already ended it. Found with `.exitmacro`.

### 1.62 A call in a loop header listed with a space

`.repeat sq(2) AS i` is listed `.repeat sq ($02) AS i`, and `.repeat .lobyte(2) AS i` is listed `.repeat . lobyte ($02) AS i`: `tokensText` spaces the tokens of a call, its dot and its `(`. Found with 4.8.

### 1.63 A `.macro` / `.function` definition listed in quotes

`.function sq(x) = x * x` is listed `.function "sq(x) = x * x"`, and `.macro m a` as `.macro "m(A)"`: the lister quotes the text it's given, as for 1.58. Found with 4.8.

### 1.64 A function's body is only read when it's called

`.function f(x) = x +* 2` or a body with `.retrun x` is an error only where `f` is called: a function never called, in a library, keeps its typo. The one-line form's expression could be parsed at the definition, without evaluating it, and a block's statements checked as a branch not taken is (`Parser.checkDirectives`). Found with 4.8.

### 1.66 A 6809 or RV32I branch to a fixed address in a relocatable segment

In a relocatable segment, the instruction's PC is its offset there: a branch to a fixed address is computed from it, silently. `.segment CODE { reloc: true }` / `nop` / `bra $10` → `12 20 0D` on the 6809; `beq x0, x0, $10` the same on the RV32I. The 65xx reads its branch targets with `OperandReader.branchTarget` since #181, which rejects them (`A branch from relocatable segment 'CODE' can't reach $10: …`); the other CPUs should too. Their operands don't take relocatable values (`the 6809's operands can't take one`): fixups for them would follow, RV32I's with `%hi` / `%lo` (2.1). Found with 4.19.

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

### 3.9 A function defined in a macro body doesn't see the macro's parameters

`.macro m base` / `.function f(x) = base + x` / `.db f(1)` / `.end` → `Undefined symbol 'BASE'.`: a function's expression is evaluated without macro parameters, as it's called from anywhere. To decide: substitute them at the definition, as a nested macro call's arguments are (`substituteArgument`), or keep it an error and say so. Found with 4.8.

### 3.10 A parenthesised expression as a 6502 address

An operand starting with `(` is an indirect mode on the 6502 and 65C02, or an error: `lda (2+3)*4`, `lda (2+3)*4,x` → `Invalid addressing mode for instruction LDA`, where `lda 0+(2+3)*4` works. Until #175 the 6502 read them as expressions, and `lda ($12),x` as `lda $12,x`. To decide: keep it (as now), or read an operand that isn't an indirect shape as an expression, `(e),x` and `(e),y` without a `(zp),Y` form staying errors (they look like a typo for an indirect mode).

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
- `.for` over a numeric range;
- a `\0` escape;
- `.min`, `.max`, `.abs`, `.sin`, `.cos`, `.chr`, `.ord`: system functions to write user functions with (4.8).

### 4.10 Building an array without a loop

Building an array takes a loop of assignments (`row = .push(row, col * 16)`), each one listed. A built-in or an expression form would give it in one: `.range(start, count [, step])` with a `.map(array, function)` taking a user function (4.8, #173 and #174), or a comprehension, `[col * 16 for col in 0..15]`. Then `.db ...` emits it directly. Bigger than 4.9; decide the syntax with 4.8.

### 4.14 Project file settings on the command line

After 4.13: change any project file setting for one run, e.g. turn the listing on (`output.listing.enabled`) or a pass's listing (`output.listing.passes.pass1`), or pick another `input.cpu`. To decide: the syntax (`--output.listing.enabled true`, with the setting's path?), how a value gets its type (from the schema in `conf.ts`), how these names stay apart from the `.option` ones and their short names, and short forms for the usual ones (listing on).

### 4.15 CPU-specific directives

A CPU can bring its own directives: the 65C816's width directives (4.16), later the 6809's `.setdp`.

- **Declared by the CPU:** `CPUHandler` gets an optional list of directives.
- **Registered at startup, every CPU's:** the parser needs all directive names up front (`parser.registerDirective`). The dispatcher then rejects one the current CPU doesn't have: "`.a16` is a 65816 directive; the current CPU is 6502".
- **No shadowing:** a CPU directive can't take the name of a general one; a test checks it.
- **CPU state:** a CPU keeping state (the 65C816's M / X) gets an optional `resetState()` on `CPUHandler`, called with `resetOptions()` at the start of each pass. `findCPUHandler` gives the same instance each time, so without it the state would carry from pass 1 into pass 2 and into a reused assembler. The state is kept across `.cpu` switches: `.cpu 6502` then `.cpu 65816` finds it as it was left.

### 4.16 65C816: accumulator and index widths

The size of an immediate depends on the M and X flags: `lda #$10` is `A9 10` with an 8-bit accumulator, `A9 10 00` with a 16-bit one. The CPU handler tracks them.

- **State:** M (A and memory) and X (X / Y) are each 8, 16 or unknown. Both start at 8, as after reset. Reset at each pass, kept across `.cpu` switches (4.15).
- **Directives** (4.15), the ca65 names: `.a8`, `.a16`, `.i8`, `.i16`.
- **`SEP` / `REP`, always tracked:** `rep #n` makes the flags in `n` 16-bit (bit 5 is M, bit 4 is X), `sep #n` 8-bit. An operand not known in pass 1 is an error: it must be defined before it is used (the sizes after it depend on it).
- **Unknown widths:** `PLP` and `RTI` make M and X unknown. `XCE` changes them as 4.17 says. A directive, or a `SEP` / `REP` covering the flag, makes it known again.
- **Width-dependent immediates:** M: `LDA ADC SBC AND ORA EOR CMP BIT`; X: `LDX LDY CPX CPY`. 16 bits gives two bytes, little-endian. An unknown width is an error saying which flag and what made it unknown ("the accumulator width is unknown since the `PLP` at …; set it with `.a8` / `.a16`"). A value too large for 8 bits is an error, never truncated.
- **One instruction:** `lda.b #imm` / `lda.w #imm` force the immediate's width without changing the state. On an address `.b` / `.w` keep their 6502 meaning (direct page / absolute); `.l` is added for long.
- **Listing:** a line whose size depends on M or X shows the width it was assembled with.

Follow-ups: emulation mode (4.17); direct page / absolute / long addressing (4.18); saving and restoring the widths per `.proc`.

### 4.17 65C816: emulation mode

After 4.16. In emulation mode (E=1) M and X are forced to 8 bits and `REP` can't change them. Without tracking E, `rep #$30` right after reset (which starts in emulation) would make the tracker assemble 16-bit immediates the CPU reads as 8-bit: wrong bytes, silently.

- **State:** E is emulation, native or unknown. It starts in emulation, as after reset. Reset at each pass, kept across `.cpu` switches (4.15).
- **Directives** (4.15): `.native` and `.emulation` say which mode the code runs in. `.emulation` makes M and X 8.
- **`XCE`** swaps the carry and E. Only the idiom is followed: `clc` right before `xce` gives native, M and X unchanged; `sec` right before gives emulation, M and X 8. Any other instruction before it, or a label between them (a branch could reach the `XCE` with another carry), makes E unknown, and M and X with it unless both are 8.
- **In emulation:** a `REP` clearing bit 4 or 5, `.a16` and `.i16` are errors: they have no effect there.
- **E unknown:** a `REP` clearing bit 4 or 5 is an error until E is known again, by `clc` / `sec` + `xce` or a directive.
- **Cost:** a file of native-mode routines (a library, an included file) needs `.native` before its first `rep #$30`. One line, and it states the assumption.

### 4.18 65C816: direct page, absolute and long addressing

D (direct page) and DBR (data bank) only get their values at run time: the assembler never chooses an encoding from them. The writer knows what they hold; the assembler can point out a shorter form.

- **The size comes from the value written:** $00–$FF is direct page, $0100–$FFFF absolute, above $FFFF long, or an error for an instruction without a long form. As the 6502 does. With a variable in bank $7E, write its address in the bank (`counter = $2000`), or `.w`.
- **Suffixes:** `.b` forces direct page; on a value above $FF it's an error, not a truncation (D needn't be page-aligned: an address's low byte isn't its offset in the direct page). `.w` forces absolute; on a 24-bit address it keeps the low 16 bits (the writer says it's in the data bank). `.l` forces long.
- **`JMP` / `JSR`** absolute use the program bank, known from the PC: a target in another bank is an error suggesting `jml` / `jsl`. A branch to another bank is an error.
- **Forward references:** absolute in pass 1, as on the 6502; an error in pass 2 if the value needs long, saying to write `.l` or define the symbol earlier.
- **Hints, never encoding** (4.15 directives): `.dp <expr>` and `.dbank <expr>` say what D and DBR hold. They only let the assembler point out a shorter form: "`$2012` is in the direct page declared at …: `lda.b $12` is one byte shorter"; "`$7E2000` is in the data bank declared at …: `lda.w $7E2000` is one byte shorter". Without them, no hint.
- **Hints are reported** at a level of their own, not as warnings. On by default: there are none without `.dp` / `.dbank`, so writing one is already asking for them. `.option hints off` turns them off.
- **In `Mos65xxHandler`** (#175): a `P65816` profile, with the opcode sets `[NMOS, CMOS_ADDITIONS, WDC_ADDITIONS, W65816_ADDITIONS]` (#176: `STP`, `WAI`) and no `ROCKWELL_BITOPS` (`$07` is `RMB0 zp` on the 65C02, `ORA [dp]` on the 65816), the suffix `L: 3`, a long width next to zero page and absolute in `selectAddressMode`, the bracket and stack-relative operands, the immediate size from M / X (4.16), and `MVN` / `MVP` and 16-bit relative in the encoder.

To check first: 24-bit addresses through the PC, `.org`, segments, the listing and the linker. `.org` takes any number today and nothing checks the PC's range. Relocatable labels (4.19) change how the mode is chosen: decide them first.

### 4.19 Relocatable values and fixups

For relocatable outputs (Apple IIgs OMF, 4.22; later o65 or another object format). Today a label is a plain number and the linker only receives bytes: nothing says which bytes hold an address, so no relocation record can be written.

**Plan, one PR per step,** 4.19 to 4.22:

1. The declaration: `relocatable: true` / `reloc: true`, no `start`, `.org` an error. Done in #178.
2. Relocatable values: a label in a relocatable segment is a segment and an offset, through expressions (below); an error where a plain number is needed; the listing and the `.sym` file show `CODE+$0012`. Done in #180.
3. Fixups: recorded in pass 2, for data then operands, with the shift of `<`, `>`, `^`. Done in #181, for the 65xx's operands; the other CPUs' are 1.66.
4. The linker script reads `seg.relocs` and `seg.attrs` (4.21). Done in #182.
5. The linker script reads the assembler's symbols (4.21). Done in #183.
6. OMF output: the `omf.linker.asm` script library (4.22). Done in #185.

Addressing modes go with 4.18, after step 2.

- **Relocatable segments:** declared in #178; their labels are a segment and an offset since #180.
- **Without a linker script:** an error since #180.
- **Through expressions:** done in #180, see `CHANGELOG.md`.
- **Fixups:** done in #181: `seg.relocs`, `{ offset, size, shift, segment, targetOffset }`, see `CHANGELOG.md`. Read by the linker script since #182.
- **Addressing modes (with 4.18):** a relocatable label is never direct page, whatever its offset (the 6502 / 65C02 since #181): absolute in its own segment, long elsewhere unless `.w`. "The size comes from the value" only applies to plain numbers. `jmp` / `jsr` to another relocatable segment are errors suggesting `jml` / `jsl`: its bank isn't known.
- **Where a plain number is needed:** an error since #180. Left: the CPU's widths, with 4.18.
- **Listing and symbol file:** done in #180: `CODE+0012     main:`, `label reloc = CODE+$0012`.

To decide before 4.18 is implemented, since it changes how the mode is chosen: whether a whole-program `relocatable` project setting is wanted.

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
- **To check:** a 65816 segment's code can't cross a bank (4.18's PC range; the library only checks a segment's size against its `banksize`); the library's output against a known-good file (Merlin 16+ or ORCA/M output) and in an emulator: #185 checks it against the specification only.

## 5. Documentation (REFERENCE.md)

- **Macro scope:** labels and variables in a macro body are local to the call. CLAUDE.md says it, REFERENCE doesn't.
- **`_` separator:** it works in hex and decimal too (`$FF_FF`, `1_000`); only binary is shown.
- **`<` / `>` on a value over 16 bits:** they give bits 0–7 and 8–15 (`>$12345` is `$23`).
- **`.proc` labels** can't be reached from outside (`f::loop` → `Undefined symbol`): say it, or add a way.
- **CPUs:** only the 65C02 is documented. The `.cpu` names and the 6809 and RV32I syntax aren't, and README's `input.cpu` lists `65C02` only.
- **Segment pad value:** `padValue` in the project file, `pad` in `.segment`. Document both, or unify.
