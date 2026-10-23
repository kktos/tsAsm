# Linker scripts

A linker script builds the output file from the segments the assembler produced: which segments go in, in what order, what goes between them, and how the file is padded.

The project file names the script:

```yaml
output:
  object:
    path: game.bin
  linker:
    script: rom.ld
```

Without a script, the segments are written directly to `output.object.path`, each at its address relative to the lowest one. With a script, the script decides, and the file is written once the script has run. The script runs after the assembly, and only when linking is on (`--link true`, the default).

- [Example](#example)
- [Source format](#source-format)
- [Output file](#output-file)
- [Writing data](#writing-data)
- [Sections](#sections)
- [Modules](#modules)
- [System variables](#system-variables)
- [Other directives](#other-directives)
- [Limitations](#limitations)

## Example

A 64-byte ROM: the code, then the other segments, then the 6 bytes of `VECTORS` at the very end, and a signature at offset `$20`.

```as
# 64-byte ROM: code and data first, vectors in the last 6 bytes
.OUTPUT "game.rom" FIXED 64 PAD $FF

.WRITE SEGMENT "CODE"
.FOR s OF .UNWRITTEN_SEGMENTS
	.IF s.name != "VECTORS"
		.LOG "adding ", s.name, " at ", .PC
		.WRITE SEGMENT(s.name)
	.END
.END

.IF .PC > 64 - 6
	.ERROR "code and data overlap the vectors"
.END
.FILL 64 - 6 - .PC, $FF
.WRITE SEGMENT "VECTORS"

.SECTION SIGNATURE AT $20
.WRITE STRING "GAME"
.WRITE BYTE 1
```

## Source format

A linker script is written like assembler source: directives start with a dot, are case-insensitive, and take the same [expressions](../../REFERENCE.md#values-and-expressions) (numbers, strings, arrays, objects, operators, [system functions](../../REFERENCE.md#system-functions)).

- **Comments** start with `#`, or are written `//` and `/* … */`. `;` is *not* a comment: that is what tells a linker script from assembler source.
- **Variables** are assigned with `=`, and can be reassigned:

  ```as
  romSize = 32 * 1024
  .OUTPUT "game.rom" FIXED romSize
  ```

- There are no labels and no CPU instructions.

## Output file

```as
.OUTPUT "<file>" [FIXED <size> [PAD <value>] | MAX <size>]
```

Sets the name of the output file, relative to the project file. Without `.OUTPUT`, the file is `output.object.path`.

- `FIXED <size>`: the file is exactly `size` bytes. What the script doesn't write is filled with `PAD` (default `0`). Writing more is an error (see [Limitations](#limitations)).
- `MAX <size>`: the file grows with what is written, up to `size` bytes. Writing more is an error.

## Writing data

The script writes to the output file, one item after the other. `.PC` is the offset where the next item goes.

```as
.WRITE <type> <value> [AT <offset>]
```

| Type | Writes |
|---|---|
| `SEGMENT <name>` | The content of a segment, padded to its size when it is a fixed segment |
| `MODULE <name>` | Every segment of a [module](#modules), in the order they were first used |
| `BYTE <value>` | A byte, `0` to `255` |
| `WORD <value>` | 2 bytes, `0` to `$FFFF` |
| `LONG <value>` | 4 bytes, `0` to `$FFFFFFFF` |
| `BYTES <array>` | The bytes of an array |
| `STRING <string>` | The characters of a string, one byte each |

```as
.WRITE SEGMENT "CODE"
.WRITE WORD $1234
.WRITE BYTES([1, 2, 3])
.WRITE BYTE 0 AT 2          # overwrite the byte at offset 2
```

A segment can be written more than once: each write appends a copy.

**Parentheses.** When the value is more than a number, a string or a symbol name, put it in parentheses: `.WRITE SEGMENT(s.name)`, `.WRITE BYTE(.lobyte(addr))`, `.WRITE BYTES([1, 2])`. Without them, the value isn't parsed.

**Byte order.** `.ENDIAN BIG` or `.ENDIAN LITTLE` sets the byte order of the words and longs that follow: `.WRITE WORD`, `.WRITE LONG`, and the data directives below. The default is little-endian.

**`AT <offset>`** writes at that offset of the output instead of appending, and doesn't move `.PC`. Only use it with `BYTE`: see [Limitations](#limitations).

The assembler's data directives work too, and always append:

| Directive | Writes |
|---|---|
| `.byte`, `.word`, `.long` `<value> [, <value> …]` | 8, 16, 32-bit values, in the `.ENDIAN` byte order |
| `.string`, `.cstring`, `.pstring`, `.pstringlong` `"<text>"` | A string: plain, zero-terminated, preceded by its length on 1 byte, on 2 bytes |
| `.fill <count> [, <value>]` | `count` bytes of `value` (default `0`) |
| `.align <boundary> [, <value>]` | `value` bytes (default `0`) up to the next multiple of `boundary`, counted from the start of the output |

## Sections

A section writes at a given offset of the output, over what is there.

```as
.SECTION <name> AT <offset>
```

What follows is written at `offset`, one item after the other, until the next `.SECTION`. Sections are applied at the end, once the output is complete and padded: they overwrite it.

```as
.SECTION <name>
```

without `AT` goes back to appending to the output.

```as
.OUTPUT "game.rom" FIXED $8000 PAD $FF
.WRITE SEGMENT "CODE"

.SECTION HEADER AT $7FF0
.WRITE STRING "MYGAME"
.WRITE WORD $0100

.SECTION REST
.WRITE SEGMENT "DATA"       # appended after CODE
```

In a section, only `.WRITE BYTE`, `WORD`, `LONG`, `BYTES`, `STRING` and the data directives go to the section: `.WRITE SEGMENT` and `.WRITE MODULE` always append to the output. To place a segment at an offset, write up to it with `.FILL`, as in the [example](#example). Use sections with a `FIXED` output.

## Modules

A module is a group of segments. In the source, `.module <name>` starts a module: the segments used after it belong to it, until the next `.module`.

```as
.segment CODE { start: $8000, size: $100 }
.segment LIBCODE { start: $A000, size: $100 }

.module GAME
.segment CODE
    ...
.module LIB
.segment LIBCODE
    ...
```

The script writes a whole module with `.WRITE MODULE`:

```as
.WRITE MODULE "LIB"
.FOR m OF .UNWRITTEN_MODULES
	.WRITE MODULE(m.name)
.END
```

`.module` only works with segments defined in the source, before the first `.module`: see [Limitations](#limitations).

## System variables

Read-only values, prefixed with a dot.

| Variable | Value |
|---|---|
| `.pc` | Offset in the output where the next item goes |
| `.image_end` | The size of the output: its `FIXED` size, otherwise what has been written so far |
| `.filename` | The current script file |
| `.segments_list` | Every segment, as an array of [segments](#segments-and-modules) |
| `.unwritten_segments` | The segments not written yet |
| `.modules_list` | Every module, as an array of [modules](#segments-and-modules) |
| `.unwritten_modules` | The modules not written yet |

The function `.segment("<name>")` returns a segment by name.

### Segments and modules

A segment has the fields `name`, `start` (its address), `size`, `data` (its bytes), `padValue`, `resizable` and `emitted` (true once written). A module has `name`, `segments` (an array of segments) and `size` (the sum of their sizes).

```as
.FOR s OF .segments_list
	.LOG s.name, " ", .hex(s.start), " ", s.size
.END

code = .segment("CODE")
.LOG "CODE is ", code.size, " bytes"
```

Read the fields from a variable: `.segment("CODE").size` doesn't work.

## Other directives

| Directive | Effect |
|---|---|
| `.include "<file>"` | Run another script file, relative to the current one |
| `.if` / `.else` / `.end` | [Conditional](../../REFERENCE.md#conditional-assembly) |
| `.for … of …` / `.repeat` | [Loops](../../REFERENCE.md#loops) |
| `.macro` / `.end` | [Macros](../../REFERENCE.md#macros), called by name |
| `.log`, `.warning`, `.error` `<value> [, <value> …]` | Print the values; `.error` stops the link |

## Limitations

- Errors in a linker script don't give the file and column, and some give no line at all.
- `.WRITE WORD` and `.WRITE LONG` with `AT` write a single wrong byte. `.WRITE STRING` and `.WRITE BYTES` ignore `AT`.
- `.SECTION … AT` may be misplaced when the output isn't `FIXED`.
- `.module` fails ("Segments were used before any module was defined") when the project file defines segments, as the first one is selected before the source starts.
- Writing more than the `FIXED` size, or a fixed segment written past its end, fails with `RangeError: Invalid array length` instead of a clear error.
- A value after `.WRITE <type>` needs [parentheses](#writing-data) unless it is a number, a string or a symbol name.
