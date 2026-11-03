# tsAsm for VS Code

The language of the [tsAsm](https://github.com/kktos/tsAsm) assembler, for `.asm` files:

- **Syntax colouring** of the language in [REFERENCE.md](../../REFERENCE.md): instructions, directives, labels (local and anonymous too), macro calls, numbers, strings, comments, system functions and variables. A `.define` block is coloured as YAML or JSON, and a `.hex` block as hex digits.
- **File links:** the path of an `.include`, an `.incbin` or a `.define … from` opens its file, with Cmd+click (Ctrl+click on Windows and Linux).

Another extension can be mapped to the language in the settings: `"files.associations": { "*.s": "tsasm" }`.

## Instructions and macro calls

The first word of a statement is an instruction when a CPU of tsAsm has it, whatever the current `.cpu`: the grammar has the mnemonics of every CPU. Any other word followed by arguments is a macro call, and one alone is a label. The grammar is built from the CPUs' code, so it follows them; a CPU a library user brings isn't in it.

## Links

A path is linked when it's a string alone, relative to the file it's in, as the assembler reads it. A path built by an expression (`.include "gfx/" + name`) is only known when it's assembled, and isn't linked. In a macro body, the assembler reads a path relative to the file the macro is called from: the link is relative to the file the macro is defined in.

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

The grammar is built by `src/vscode/grammar.ts` and the links found by `src/vscode/links.ts`, both tested in `src/tests/vscode`.
