# tsAsm for VS Code

The language of the [tsAsm](https://github.com/kktos/tsAsm) assembler, for `.asm` files:

- **Syntax colouring** of the language in [REFERENCE.md](../../REFERENCE.md): instructions, directives, labels (local and anonymous too), macro calls, numbers, strings, comments, system functions and variables. A `.define` block is coloured as YAML or JSON, and a `.hex` block as hex digits.
- **File links:** the path of an `.include`, an `.incbin` or a `.define … from` opens its file, with Cmd+click (Ctrl+click on Windows and Linux).
- **Errors and warnings** in the Problems panel: the extension assembles each project of the workspace as the CLI does, while you type.
- **Go to a definition:** Cmd+click on a name (F12) goes to where it's defined, and its hover tells what it is: a label's or a constant's value, in hex and decimal, a variable's value there, a macro's or a function's parameters.
- **Find all references:** Shift+F12 lists where a name's symbol is used, in every file of its project, and its definition.
- **Rename** (F2): a symbol, at its definition and its references, in every file of its project.
- **Outline and breadcrumbs** (Cmd+Shift+O): a file's macros, procs, functions and namespaces, with the labels, constants and variables in them, a local label under its global one, and its `.segment` selections; **Cmd+T** finds a symbol in the workspace.

Another extension can be mapped to the language in the settings: `"files.associations": { "*.s": "tsasm" }`.

## Instructions and macro calls

The first word of a statement is an instruction when a CPU of tsAsm has it, whatever the current `.cpu`: the grammar has the mnemonics of every CPU. Any other word followed by arguments is a macro call, and one alone is a label. The grammar is built from the CPUs' code, so it follows them; a CPU a library user brings isn't in it.

## Links

A path is linked when it's a string alone, relative to the file it's in, as the assembler reads it. A path built by an expression (`.include "gfx/" + name`) is only known when it's assembled, and isn't linked. In a macro body, the assembler reads a path relative to the file the macro is called from: the link is relative to the file the macro is defined in.

## Errors and warnings

A source is assembled through its project file, which tells which source is the main one: an included file alone doesn't assemble. The projects are the files the `tsasm.project` setting names, relative to the workspace folder (`"tsasm.project": "build/game.yaml"`, or a list), else every YAML file of the workspace with an `input.source`.

Each project is assembled as `tsasm` does, without writing its output: a moment after the typing stops, from the editor's buffers, saved or not, and again when a file it reads changes on the disk. Its errors and warnings are in the Problems panel and under their token, with the places they're about: a symbol's first definition, the macro calls and `.include` directives that led there. An error in the project file is in it, at its setting.

An assembly stops at its first error: the errors after it show once it's fixed.

## Definitions, hovers and references

A name is what the assembler made of it: a label, a constant, a variable, a local or anonymous label, a function or its parameter, a macro, in its namespace, its `.proc` or its macro call. So they come from the last assembly that succeeded. While a file has an error, its names keep working, their places moved with the edits made since; a name you change is only known again once the project assembles.

A name in a macro body can refer to a symbol of each call: Cmd+click lists them all, and the hover tells up to five. Their references are one list: the symbols a macro body defines are all defined at the same place, and a name in the body is listed once, not once per call. A namespace, a segment, and a name in `.def()` aren't linked yet.

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

## Building and installing

From the root of the repository:

```shell
pnpm install
pnpm build:vscode       # writes editors/vscode/dist: the extension's code and its grammar
cd editors/vscode
pnpm dlx @vscode/vsce package --skip-license --no-dependencies
code --install-extension tsasm-0.1.0.vsix
```

While working on it, link the folder into VS Code's extensions instead, then run `pnpm build:vscode` and reload the window after each change:

```shell
ln -s "$PWD/editors/vscode" ~/.vscode/extensions/kktos.tsasm
```

The grammar is built by `src/vscode/grammar.ts`, the links found by `src/vscode/links.ts`, a project assembled by `src/vscode/analysis.ts`, its names indexed by `src/vscode/symbol-index.ts` and renamed by `src/vscode/rename.ts`, a file's blocks read by `src/vscode/blocks.ts` and its outline built by `src/vscode/outline.ts`, all tested in `src/tests/vscode`. `src/vscode/projects.ts` puts the projects' errors in VS Code, and `src/vscode/navigation.ts` gives the definitions, the hovers, the references, the renames and the outline.
