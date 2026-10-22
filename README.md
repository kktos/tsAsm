# tsAsm

A 65C02 assembler written in TypeScript, usable as a command-line tool or as a library.

Features include macros, conditional assembly, loops, namespaces, functions, segments, YAML/JSON data blocks, and a linker scripting language.

The complete syntax is documented in **[REFERENCE.md](REFERENCE.md)**.

## Installation

```shell
git clone https://github.com/kktos/tsAsm.git
cd tsAsm
pnpm install
pnpm build
```

The build produces the command-line tool `dist/tsasm` and the library bundle `dist/libtsasm.js`.

## Command line

```shell
node dist/tsasm <project-file> [--link true|false]
```

| Option | Description |
|---|---|
| `<project-file>` | Project configuration file (YAML). Required. |
| `-l`, `--link <true\|false>` | Run the final linking stage and write the output file (default: `true`). |
| `-h`, `--help` | Show the help. |

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

| Key | Description |
|---|---|
| `input.source` | Main source file. Required. |
| `input.cpu` | CPU to assemble for: `65C02`. |
| `input.segments` | List of segments: `name`, `start`, `size`, and optionally `padValue` and `resizable`. The first one is selected at the start. |
| `output.object.path` | Output file for the assembled code. |
| `output.linker.script` | Linker script to use instead of writing the segments directly (see [linker_script.md](src/linker/linker_script.md)). |
| `output.listing` | `enabled`, `path`, and `passes: { pass1, pass2 }` to list each pass. |
| `output.symbols` | `enabled` and `path` of the symbol file (YAML). |
| `output.segments` | `enabled` and `path` of the segment map file (YAML). |

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

When the source has an error, `assemble()` throws an `AsmError` (`src/utils/error.utils.ts`): `message` says what is wrong, `location` where (`{ file, line, column }`), and `format()` gives `file:line:column: error: message`, followed by the source line with a caret under the column. In a macro body, the location is the body line, in the file the macro is defined in, and `macroStack` lists the calls it comes from (innermost first).

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
