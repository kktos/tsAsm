# tsAsm

A multi-cpu assembler written in TypeScript, usable as a command-line tool or as a library.

Features include macros, conditional assembly, loops, namespaces, procedures, segments, YAML/JSON data blocks, and a linker scripting language.

The complete syntax is documented in **[REFERENCE.md](REFERENCE.md)**.

## Installation

```shell
git clone https://github.com/kktos/tsAsm.git
cd tsAsm
pnpm install
pnpm build
```

The build produces the command-line tool `dist/tsasm` and the library bundle `dist/libtsasm.js`.
Every build (`build`, `build:cli`, `build:lib`) first increments the patch number of the version in `package.json` (2.0.0 → 2.0.1); `pnpm version:bump` does only that.
`dist/tsasm` is a single file that only needs Node.js.

To run it as a `tsasm` command from any directory (macOS, Linux or Windows):

```shell
pnpm install:cli
```

This links the command into npm's global bin directory, which is normally in your `PATH`; use `pnpm install:cli --dir <directory>` to pick another one. As it is a link to `dist/tsasm`, a new build is picked up without reinstalling. `pnpm uninstall:cli` removes it.

## Command line

```shell
node dist/tsasm <project-file> [--link true|false] [-O <option>=<value>]…
```

| Option                       | Description                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `<project-file>`             | Project configuration file (YAML). Required.                                            |
| `-l`, `--link <true\|false>` | Run the final linking stage and write the output file (default: `true`).                |
| `-O <option>=<value>`        | Set a [`.option`](REFERENCE.md#assembler-settings) value for this run. Can be repeated. |
| `--<option> <value>`         | The same, also written `--<option>=<value>`.                                            |
| `-h`, `--help`               | Show the help, with the options, their short names and values.                          |

A `.option` value given on the command line overrides the project file's `input.options`, for one run: `tsasm proj.yaml -O listing.data=expand`, `tsasm proj.yaml --listing.data expand`. A `.option` in the source still applies after it. Each option has a short name: `-O ld=expand`, `--ld expand`.

| Option               | Short name |
| -------------------- | ---------- |
| `local.prefix`       | `lp`       |
| `anon.marker`        | `am`       |
| `listing.case`       | `lc`       |
| `listing.data`       | `ld`       |
| `repeat.start`       | `rs`       |
| `for.start`          | `fs`       |
| `function.recursion` | `fr`       |

An unknown option, a wrong value or an option given twice is an error.

### A first project

`hello.asm`:

```as
COUT = $FDED

	ldx #0
loop:
	lda message, x
	beq done
	jsr COUT
	inx
	bra loop
done:
	rts

message:
	.cstr "HELLO"
```

`project.yaml`:

```yaml
input:
    cpu: 65C02
    source: hello.asm
    segments:
        - { name: CODE, start: 0x0800, size: 0, resizable: true }

output:
    object:
        path: hello.bin
    listing:
        enabled: true
    symbols:
        enabled: true
```

Run it from the project's directory:

```shell
node path/to/tsAsm/dist/tsasm project.yaml
```

This writes `hello.bin` (the machine code), `hello.asm.lst` (the listing) and `hello.asm.sym` (the symbols).

### Project file

| Key                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input.source`         | Main source file. Required.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `input.cpu`            | The CPU the source starts with, `6502` by default: `65C02`. `.cpu` can switch to any CPU the CLI has: `6502`, `65C02`, `6809`, `RV32I`.                                                                                                                                                                                                                                                                                                   |
| `input.segments`       | List of segments: `name`, `start`, `size`, and optionally `padValue`, `resizable` and `banksize` (see [segments](REFERENCE.md#segments)). A relocatable one has `relocatable: true` (or `reloc: true`), no `start`, and grows without a `size`. Any other key is an [attribute](REFERENCE.md#segments), a number or a string, for the linker script. The first one is selected at the start.                                              |
| `input.options`        | The [`.option`](REFERENCE.md#assembler-settings) values the source starts with: `local.prefix`, `anon.marker`, `listing.case`, `listing.data`, `repeat.start`, `for.start`, `function.recursion`, e.g. `{ local.prefix: "@" }`. The local ones, `repeat.start` and `for.start`, are also what each included file starts with: see [global and local options](REFERENCE.md#global-and-local-options). The library takes them as `options`. |
| `input.linker.maxSize` | The largest output file, in bytes, with or without a linker script: from 1 to `0x1000000` (16 MB), default `0x100000` (1 MB). Without a script, the output runs from the lowest segment to the highest, its gaps filled with zeros: past this size, linking is an error. The library takes it as `linker: { maxSize }`.                                                                                                                   |
| `output.object.path`   | Output file for the assembled code.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `output.linker.script` | Linker script to use instead of writing the segments directly (see [linker_script.md](src/linker/linker_script.md)).                                                                                                                                                                                                                                                                                                                      |
| `output.listing`       | `enabled`, `path`, `passes: { pass1, pass2 }` to list each pass, and `linker` to list the linking: the linker script's report and `.log`s, or without a script each segment's place in the output.                                                                                                                                                                                                                                        |
| `output.symbols`       | `enabled` and `path` of the symbol file (YAML): see [symbol file](#symbol-file).                                                                                                                                                                                                                                                                                                                                                          |
| `output.segments`      | `enabled` and `path` of the segment map file (YAML).                                                                                                                                                                                                                                                                                                                                                                                      |

Paths are relative to the project file. Missing output directories are created.

### Symbol file

The symbols by namespace: `global` for the default one, a namespace's metadata after its name. A symbol's line gives its kind (`var` for `=`, `.let` and `.define`, `const` for `.equ`, `label`), its type (`number`, `string`, `array` or `object`; a label is a `number`, or `reloc` in a relocatable segment, its value its segment and offset: `CODE+$0012`), its value (in hex on as many digits as the bytes holding it: `$28`, `$0400`, `$010000`) and where it's defined, at its name:

```yaml
GFX [BASE=8192]:
    W: const number = $28 ;hello.asm:15:1
global:
    COUNTER: var number = $02 ;hello.asm:3:1
    SCREEN: const number = $0400 ;hello.asm:1:1
    SPRITES: var object = {"x":1} ;hello.asm:4:9
    START: label number = $0800 ;hello.asm:7:1
    START.LOOP: label number = $0800 ;hello.asm:8:1
    PRINT: label reloc = CODE+$0012 ;lib.asm:4:1
```

A variable has its last value, and the place it was last assigned. A `.proc`'s symbols follow its name, as local labels do: `CLEAR.LOOP`. The symbols of a macro call are left out.

## Library

The package doesn't export the CPU handlers yet, so for now import the TypeScript sources directly:

```ts
import { readFileSync } from "node:fs";
import { Assembler } from "./tsAsm/src/assembler/polyasm";
import { Cpu65C02Handler } from "./tsAsm/src/cpu/cpu65c02.class";

const fileHandler = {
	fullpath: "",
	filename: "",
	// used by .include
	readSourceFile: (filename: string) => readFileSync(filename, "utf-8"),
	// used by .incbin
	readBinaryFile: (filename: string) => Array.from(readFileSync(filename)),
};

const assembler = new Assembler(new Cpu65C02Handler(), fileHandler, {
	segments: [{ name: "CODE", start: 0x0800, size: 0, resizable: true }],
});

assembler.assemble(`
	lda #$41
	jsr $FDED
	rts
`);

const bytes = assembler.link(); // [0xa9, 0x41, 0x20, 0xed, 0xfd, 0x60]
```

The first argument is the CPUs the source can use: one handler, or an array. `.cpu` only switches to these, by their `cpuType`, in any case, and an unknown name is an error that lists them. The source starts with the first one, or with the one the `cpu` option names:

```ts
const assembler = new Assembler([new Cpu6502Handler(), new Cpu65C02Handler()], fileHandler, { cpu: "65C02" });
```

A handler gives the width of its address bus, `addressBits` (16 on the 6502, 32 on the RV32I): the PC stays in `0` to `2 ** addressBits - 1`. A handler whose PC doesn't carry into the next bank gives `bankBits`, the PC's width in its bank (16 for the 65816): an instruction whose bytes cross a bank is then an error, data isn't. A handler can bring its own directives (`CPUHandler.directives`, by upper-case name), which run only while it is the current CPU; a name can't be a general directive's (the constructor throws). A handler keeping state gets `resetState()`, called at the start of each pass for every CPU given, as the same handlers are used for each pass and each `assemble()`.

When the source has an error, `assemble()` throws an `AsmError` (`src/utils/error.utils.ts`): `message` says what is wrong, `location` where (`{ file, line, column }`), and `format()` gives `file:line:column: error: message`, followed by the source line with a caret under the column. In a macro body, the location is the body line, in the file the macro is defined in, and `macroStack` lists the calls it comes from (innermost first). In an included file, `includeStack` lists the `.include` directives it was reached through (innermost first), shown as `included from file:line:column` lines; for an `.include` in a macro body, its place in the macro's file is followed by the macro calls that led there (with `macro` set), shown as `in macro M, called at file:line:column` lines. `notes` are the other places the error is about, each with its own `includeStack`: a redefinition has a `first defined here` note (for a definition in a macro body, at its line in the macro's file, with the macro calls first in its `includeStack`). Warnings go to the logger as `AsmError`s too, located the same way, with `severity` set to `"warning"`. A linker script's errors (`assembler.linker.link(script, …)`) are `AsmError`s too, located the same way in the script.

```ts
try {
	assembler.assemble(source);
} catch (e) {
	if (e instanceof AsmError) console.error(e.format()); // main.asm:3:7: error: …
}
```

To use `.define` blocks, pass the data processors in the options, for example:

```ts
import { load } from "js-yaml";

const assembler = new Assembler(cpu, fileHandler, {
	rawDataProcessors: {
		default: "YAML",
		map: new Map([
			["YAML", (text) => load(text)],
			["JSON", (text) => JSON.parse(text)],
		]),
	},
});
```

## Development

```shell
pnpm test       # unit tests
pnpm check      # type check
pnpm lint:ci    # lint
```

## License

MIT
