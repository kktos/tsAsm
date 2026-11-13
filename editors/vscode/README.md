# tsAsm for VS Code

The language of the [tsAsm](https://github.com/kktos/tsAsm) assembler, for `.asm` files, and of its [linker scripts](#linker-scripts), `.linker.asm`:

- **Syntax colouring** of the language in [REFERENCE.md](../../REFERENCE.md): instructions, directives, labels (local and anonymous too), macro calls, numbers, strings, comments, system functions and variables. A `.define` block is coloured as YAML or JSON, and a `.hex` block as hex digits.
- **Colours from the assembly:** a name the assembler resolved is coloured as what it is, a label, a constant, a variable, a function or its parameter, a macro, wherever it's written.
- **File links:** the path of an `.include`, an `.incbin` or a `.define … from` opens its file, with Cmd+click (Ctrl+click on Windows and Linux).
- **Errors and warnings** in the Problems panel: the extension assembles each project of the workspace as the CLI does, while you type.
- **Code not assembled** is faded: an `.if` branch not taken, a macro or a function never called.
- **Go to a definition:** Cmd+click on a name (F12) goes to where it's defined, and its hover tells what it is: a label's or a constant's value, in hex and decimal, a variable's value there, a macro's or a function's parameters.
- **Find all references:** Shift+F12 lists where a name's symbol is used, in every file of its project, and its definition.
- **Addresses:** each line's address at its end, as an inlay hint, its bytes in its tooltip.
- **Instructions:** a mnemonic's hover lists its forms on the current CPU, with their addressing modes, opcodes and sizes, the line's marked.
- **Listing:** "tsAsm: Show Listing" opens the project's listing beside the file, at the cursor's line, and follows the cursor.
- **Completion and signature help:** the current CPU's mnemonics, the directives and macros at a statement's start; the symbols in scope, the local labels, the system functions and variables in an operand; a call's parameters as you type them.
- **Rename** (F2): a symbol, at its definition and its references, in every file of its project.
- **Folding** by blocks: `.macro`, `.proc`, each branch of an `.if`, `{ }`, a routine under its label, comments and `; region` … `; endregion`.
- **Formatting** (Format Document, `editor.formatOnSave`): labels, mnemonics, operands and comments in their columns, a block's body indented, with tabs or spaces and the columns a project's `.editorconfig` sets.
- **Outline and breadcrumbs** (Cmd+Shift+O): a file's macros, procs, functions and namespaces, with the labels, constants and variables in them, a local label under its global one, and its `.segment` selections; **Cmd+T** finds a symbol in the workspace.

Another extension can be mapped to the language in the settings: `"files.associations": { "*.s": "tsasm" }`. A pattern there wins over the extensions: `"*.asm": "tsasm"` would make the linker scripts sources too.

## Linker scripts

A [linker script](../../src/linker/linker_script.md) named `*.linker.asm` is a language of its own, "tsAsm linker script": VS Code gives a file the language of its longest extension, so the other `.asm` files stay sources. A file a script includes is one too only when it's named so.

- **Syntax colouring:** `#`, `//` and `/* */` comments, `;` not being one; directives, `.OUTPUT`'s `FIXED`, `PAD` and `MAX`, `.WRITE`'s type and `AT`, `.SECTION`'s name, `.ENDIAN`'s `BIG` / `LITTLE`, variables, macros and their calls, and the sources' expressions. There are no labels nor instructions: a word starting a statement is a macro call, `OMF_FILE "main"`, or a variable before `=`.
- **Comments:** Cmd+/ writes `#`.
- **File links:** the path of an `.include` opens its file.

The rest, formatting, completion, hovers, the outline, is the sources' only. A project is assembled without linking it: a script's errors are only the CLI's.

## Instructions and macro calls

The first word of a statement is an instruction when a CPU of tsAsm has it, whatever the current `.cpu`: the grammar has the mnemonics of every CPU. Any other word followed by arguments is a macro call, and one alone is a label. The grammar is built from the CPUs' code, so it follows them; a CPU a library user brings isn't in it.

## Links

A path is linked when it's a string alone, relative to the file it's in, as the assembler reads it. A path built by an expression (`.include "gfx/" + name`) is only known when it's assembled, and isn't linked. In a macro body, the assembler reads a path relative to the file the macro is called from: the link is relative to the file the macro is defined in.

## Errors and warnings

A source is assembled through its project file, which tells which source is the main one: an included file alone doesn't assemble. The projects are the files the `tsasm.project` setting names, relative to the workspace folder (`"tsasm.project": "build/game.yaml"`, or a list), else every YAML file of the workspace with an `input.source`.

Each project is assembled as `tsasm` does, without writing its output: a moment after the typing stops, from the editor's buffers, saved or not, and again when a file it reads changes on the disk. Its errors and warnings are in the Problems panel and under their token, with the places they're about: a symbol's first definition, the macro calls and `.include` directives that led there. An error in the project file is in it, at its setting.

An assembly stops at its first error: the errors after it show once it's fixed.

## Code not assembled

The code the last assembly didn't read is faded, as VS Code fades unused code: an `.if` branch not taken, the body of a macro or a `.function` never called, a `.repeat 0`'s. Its hover says why; it isn't in the Problems panel. VS Code's `editorUnnecessaryCode.opacity` colour sets how faded it is.

- A block whose directive was read keeps its `.end`, `.else`, `.elseif` and braces: an unused macro's `.macro` and `.end` lines aren't faded, only its body. A `.define`'s or a `.hex`'s text is read with its directive.
- The comments and blank lines between faded lines are faded with them.
- A file read by two projects is faded where neither read it: a branch one build takes stays shown.
- It comes from the last assembly that succeeded, moved with the edits since; a line being edited shows as read until the project assembles.

## Definitions, hovers and references

A name is what the assembler made of it: a label, a constant, a variable, a local or anonymous label, a function or its parameter, a macro, in its namespace, its `.proc` or its macro call. So they come from the last assembly that succeeded. While a file has an error, its names keep working, their places moved with the edits made since; a name you change is only known again once the project assembles.

A name in a macro body can refer to a symbol of each call: Cmd+click lists them all, and the hover tells up to five. Their references are one list: the symbols a macro body defines are all defined at the same place, and a name in the body is listed once, not once per call. A namespace, a segment, and a name in `.def()` aren't linked yet.

## Colours from the assembly

The grammar colours from the text alone: a label's reference looks like any other word, and a local label is told by its prefix only at a statement's start, as the prefix `.option local.prefix` sets isn't known to it. The assembly knows what each name is: the names it resolved are coloured with the grammar's colours for what they are, a label's reference as a label, a constant as an `.equ`, `!loop` as a local label after `.option local.prefix "!"`. A qualified name gets its name coloured, its namespace left to the grammar.

They come from the last assembly that succeeded, their places moved with the edits since: a name being typed keeps the grammar's colour until the project assembles. The code the assembly didn't read, an `.if` branch not taken or a macro never called, keeps the grammar's colours, faded (see [code not assembled](#code-not-assembled)).

## Addresses

Each line that the assembly wrote bytes for gets its address at its end, `$1000`, as an inlay hint; its bytes are in the hint's tooltip. A label alone on its line gets its address too, and a relocatable segment's line its offset there, `CODE+$0012`.

- A line assembled several times, in a loop's body or a macro's, gets its first address and how many times: `$1003 ×4`.
- A macro call, an `.include` and a loop's header get the first address of what they assembled, and its size in the tooltip.

They come from the last assembly that succeeded, moved with the edits since; a line being edited loses its address until the project assembles. VS Code's `editor.inlayHints.enabled` turns them off, or shows them while Ctrl+Alt is held, for every language or for tsAsm alone (`"[tsasm]": { "editor.inlayHints.enabled": "offUnlessPressed" }`).

## Instructions

The hover on a mnemonic lists the ways to write it on the current CPU, the last `.cpu` above the line, else the project's: each one's operands, as an example (`lda $12,x`), its addressing mode, its opcode and its size in bytes. The 6809's opcodes have their page prefix (`10 8E` for `ldy #`), and an indexed operand takes from two bytes to four; the 65816's immediates take one byte or two, by the register's width; the RV32I gives its formats and fields instead (`opcode $33, funct3 0, funct7 $20`).

The form the line assembled to is marked ▶, from its bytes in the last assembly, and its bytes are shown; a line assembled several times shows its first run's. A file in no project gets every CPU having the mnemonic, unmarked.

## Listing

**tsAsm: Show Listing**, in the command palette or the editor's title bar, opens the listing of the file's project beside it, read-only, at the cursor's line, highlighted. It's the listing the CLI writes with `output.listing.pass2`, with the project's `listing.case` and `listing.data`, whether `output.listing` lists pass 2 or not, and its tab is named as the CLI's file; nothing is written.

- While it's shown, it follows the cursor in the project's files: a line goes to its first listing line, a macro call to the call's, then its body's, an `.include` to the included file's. A line that listed nothing (a comment, a blank line) scrolls to the closest line above that did, without highlighting.
- A file in two projects asks which one's.
- It comes from the last assembly that succeeded, its ties moved with the edits since, and is read again on each assembly.

## Completion and signature help

At a statement's start, after a label too, completion offers the mnemonics of the current CPU (the last `.cpu` above, else the project's `input.cpu`, else every CPU's for a file in no project), the macros, and after a dot the directives, a CPU's own only for it. They're written in the case typed, `LD` → `LDA`, else as most of the file's.

In an operand, it offers:

- the symbols reachable by their bare name there: the global ones, the current namespace's, the current `.proc`'s, macro's or function's;
- another namespace's symbols as `gfx::sprite`, the namespaces as `gfx::`, and after `gfx::` its symbols;
- after a local label's prefix, the local labels under the global label before the cursor;
- after a dot, the system functions and variables, with what each gives;
- `.option`'s names and `.cpu`'s CPUs.

The symbols come from the last assembly that succeeded, with their values. A function is inserted with its `(`, and its parameters shown.

Signature help shows a call's parameters, the one at the cursor highlighted: a system function's (`.pad(value, width, fill?)`), a function's, a macro's, in parentheses or as operands (`clear addr, ...rest`).

## Rename

F2 renames a symbol where the last assembly read it: its definition, each assignment of a variable, its references. A qualified name, `gfx::sprite`, gets its name renamed, not its namespace, and a local label keeps its prefix, typed with the new name or not. Every place gets the new name as typed: names don't care about case.

Where the assembly didn't read the name (an `.if` branch not taken, a macro never called, `.def(name)`), it's found in the files' text, outside comments and strings, and renamed too, to confirm: VS Code shows these changes in its preview first. A local label's are looked for under its global label only.

A rename is refused, saying why:

- while the project doesn't assemble: the names written since its last assembly would be missed;
- for an anonymous label, and for a symbol whose name is built by an expression, `.let "pos" + "X"`;
- for a name in a macro body that refers to a symbol of a namespace at one call and of another namespace at another: renaming one would rename both;
- when the project, assembled with the new name, fails (the name is taken) or has a name referring to another symbol than before (the new name shadows another one, or another one shadows it).

## Outline

A file's blocks come from its text: `.macro`, `.proc`, `.function` with a body, up to their `.end` or in `{ }`, and `.namespace` up to `.end namespace` (or a bare `.namespace`). They're in the outline even while the file doesn't assemble, or when it's in no project. The labels, constants and variables in them come from the last assembly that succeeded, each in the innermost block around it, with its value; a local label is under the global label before it. A `.segment` selection is a marker, with nothing under it: a segment isn't a block. Anonymous labels and a macro call's symbols aren't listed.

Cmd+T lists every project's symbols but local and anonymous labels, whose names repeat everywhere, and the namespaces of their files.

## Folding

The folds follow the blocks, read from the text as the outline's, not the indentation, so a block written flat folds too:

- `.macro`, `.proc`, `.function`, `.namespace`, `.repeat`, `.for`, `{ }`, and the raw text of `.define` and `.hex`;
- each branch of an `.if`;
- the code under a global label, a routine, up to the next global label, the next block holding code or the end of the block it's in. Its trailing blank and comment lines are left out: a comment above a routine is that routine's. The labels come from the last assembly that succeeded, so a file in no project folds its blocks only;
- two comment lines or more, and `; region name` … `; endregion` (`#region`, `//` too).

A block's `.end` or `}` stays shown when it's folded. A `.segment` doesn't fold: it's a selection, not a block.

## Formatting

Format Document (Shift+Alt+F) and Format Selection lay a file out in columns; `"[tsasm]": { "editor.formatOnSave": true }` does it on save.

```as
start:  lda     #$00                    ; load 0
        sta     $D020
        .repeat 3 {
:loop       dex
            bne     :loop
        }
HEIGHT  =       5
```

- **The settings are in `.editorconfig`, all of them, and only there:** the extension has neither settings nor defaults for them, so a project's files are laid out the same way whoever formats them, and whatever version of the extension, and of the coming `tsasm fmt` (TODO 4.39), does it. Each is required, from any section whose glob matches the file:

    ```ini
    [*.{asm,inc}]
    indent_style = tab           # or space
    tab_width = 4                # with spaces, indent_size
    tsasm_opcode_column = 8
    tsasm_operand_column = 16
    tsasm_comment_column = 40
    tsasm_indent_blocks = true
    ```

    They're read as EditorConfig reads its own, without its extension: from the file's folder up to an `.editorconfig` with `root = true`, the closest winning, in the sections whose glob matches the file.

- **A missing key** leaves the file as it is: the message names the keys, and its button adds them, with the values above: a section at the end of the `.editorconfig` beside the project file (beside the workspace folder for a file in no project), its glob the extensions of the files the project reads statements from, only the keys they lack. It refuses when that section would change a file's settings (a later section overriding an earlier one), or a closer `.editorconfig` would hide it: those keys are yours to write. An unsaved file has no `.editorconfig`: it isn't formatted.
- **A bad value:** a `tsasm_*` key it doesn't know or a bad value (`tsasm_opcode_column = abc`) is an error: the file isn't formatted, and the message opens the `.editorconfig` at its line. A value of EditorConfig's own keys it doesn't know (`indent_style = tabs`) is no value, as EditorConfig says: the key is missing.
- **The columns:** a label at the line's start; the mnemonic, directive or macro call in the opcode column, `tsasm_opcode_column`; its operand in `tsasm_operand_column`; a comment ending the line in `tsasm_comment_column`. Columns count from 0; with tabs, a column is rounded up to a tab stop. An assignment is a label and a directive: `HEIGHT = 5` puts `=` in the opcode column.
- **A field past its column** goes to the next tab stop: a long label pushes its mnemonic, never glued to it.
- **Blocks:** the body of a `.macro`, `.proc`, `.function`, `.if`, `.repeat` or `.for`, in braces or up to its `.end`, is one level further, its `.end`, `}` and `.else` at the block's level, its labels still at the line's start. A namespace's body isn't indented, as it may run to the end of the file. `tsasm_indent_blocks = false` turns it off.
- **Kept as written:** an operand, its spaces and strings (`lda ( $10 ),y`); a comment alone on its line; a block comment's lines; the raw text of a `.define`, a `.hex` or a `.segment`'s definition; a line starting with `#`, a linker script's comment.
- **Labels and statements:** the colon after a label is optional, so the first word of a line is a label unless it's a mnemonic of the CPU there (the last `.cpu` above, else the project's), a directive or a macro the last assembly defined. A word it can't tell, a macro of a file in no project, keeps its side: at the line's start a label, else a statement.
- **Checked:** only the whitespace between the fields changes. The result is lexed: if its tokens aren't the source's, the file is left as it is.

## Building and installing

From the root of the repository:

```shell
pnpm install
pnpm install:vscode
```

It bumps the extension's version in `editors/vscode/package.json` (a patch; `pnpm install:vscode minor`, `major`, or `--no-bump` to keep it), builds it, packages it into a `.vsix` in the system's temp directory and installs it with `code --install-extension`. `--code code-insiders` (or `cursor`…) installs it in another editor. The open windows keep the old version until they're reloaded (Developer: Reload Window).

The same, step by step:

```shell
pnpm build:vscode       # writes editors/vscode/dist: the extension's code and its grammar
cd editors/vscode
pnpm dlx @vscode/vsce package --skip-license --no-dependencies
code --install-extension tsasm-0.1.0.vsix
```

While working on it, link the folder into VS Code's extensions instead, then run `pnpm build:vscode` and reload the window after each change:

```shell
ln -s "$PWD/editors/vscode" ~/.vscode/extensions/kktos.tsasm
```

The grammars, the sources' and the linker scripts', are built by `src/vscode/grammar.ts`, the links found by `src/vscode/links.ts`, a project assembled by `src/vscode/analysis.ts`, its names indexed by `src/vscode/symbol-index.ts`, renamed by `src/vscode/rename.ts`, coloured by `src/vscode/semantic.ts`, their addresses told by `src/vscode/addresses.ts`, their mnemonics described by `src/vscode/instructions.ts`, the code not read found by `src/vscode/unread.ts`, their listing tied to them by `src/vscode/listing.ts` and shown by `src/vscode/listing-view.ts`, and completed by `src/vscode/completion.ts` from the language `src/vscode/language.ts` reads in the assembler, a file's blocks read by `src/cli/format/blocks.ts`, its outline built by `src/vscode/outline.ts`, its folds by `src/vscode/folding.ts` and its layout by `src/cli/format/format.ts` with the settings `src/cli/format/editorconfig.ts` reads, all tested in `src/tests/vscode` and `src/tests/format`. `src/vscode/projects.ts` puts the projects' errors in VS Code, and `src/vscode/navigation.ts` gives the definitions, the hovers, the references, the colours, the addresses, the mnemonics' hovers, the completions, the renames, the folds and the outline; `src/vscode/format-provider.ts` formats.
