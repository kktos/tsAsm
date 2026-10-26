# tsAsm Reference

The complete syntax of the tsAsm assembler. For installation and command-line usage, see the [README](README.md).

- [Source format](#source-format)
- [Values and expressions](#values-and-expressions)
- [Symbols and labels](#symbols-and-labels)
- [Program counter and segments](#program-counter-and-segments)
- [Data](#data)
- [Strings](#strings)
- [Structured data: `.define`](#structured-data-define)
- [Conditional assembly](#conditional-assembly)
- [Loops](#loops)
- [Macros](#macros)
- [Functions](#functions)
- [Namespaces](#namespaces)
- [Files](#files)
- [Messages and listing](#messages-and-listing)
- [Assembler settings](#assembler-settings)
- [System variables](#system-variables)
- [System functions](#system-functions)
- [CPU](#cpu)

## Source format

A line holds an optional label, then an instruction, a directive or an assignment, then an optional comment.

```as
start:  lda #$00    ; load 0
        sta $D020
```

- Directives start with a dot: `.db`, `.macro`, … Their names are case-insensitive.
- Symbol names are case-insensitive: `Loop` and `LOOP` are the same symbol.
- Outside comments and strings, a character the assembler doesn't recognise is an error, even in code that isn't assembled (a false `.if`). A byte order mark at the start of a file is ignored.
- Blocks (`.if`, `.repeat`, `.for`, `.macro`, `.function`, `.define`, …) end with `.end`, or can be written with braces:

```as
.repeat 2 {
    nop
}
```

### Comments

```as
; line comment
lda #0  ; end-of-line comment
// line comment, C style
/* block comment,
   over several lines */
```

A block comment without its closing `*/` is an error.

## Values and expressions

### Numbers

```as
.db 170           ; decimal
.db $AA, 0xAA     ; hexadecimal
.db %10101010     ; binary
.db 0b1010_1010   ; binary, with _ as a digit separator
```

A number can't run into a letter or a digit outside its base: `123abc`, `0b2` or `$12g` is an error.

### Strings and characters

Strings use double or single quotes: `"Hello"` or `'Hello'`. A string ends on its line: a missing closing quote is an error. A one-character string used as a value gives its character code: `lda #"A"` loads `$41`.

Escape sequences: `\n`, `\r`, `\t`, `\b`, `\f`, `\'`, `\"`, `\\`, and `\xHH` for a character code in hexadecimal.

Each character becomes one byte, its code: a character above 255 (like `€`) doesn't fit and is an error.

```as
.text "Line1\nLine2"
.text "\x41"    ; "A"
```

### Arrays and objects

```as
list = [5, 6, 7]
.db list[1]         ; 6
```

Arrays and objects also come from [`.define`](#structured-data-define) blocks, where object properties are read with a dot: `sprites[0].x`.

Data directives only emit numbers and strings: `.db list` is an error. Index the array (`list[1]`), read the object's field, or spread the array to emit every element (`.db ...list`, see [Data](#data)).

### Operators

| Operators           | Meaning                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+` `-` `*` `/` `%` | Arithmetic. `/` is not an integer division: `7 / 2` is `3.5` (see `.floor`, `.ceil`, `.round`).                                                                                                       |
| `-` (unary)         | Negation                                                                                                                                                                                              |
| `<<` `>>`           | Shifts                                                                                                                                                                                                |
| `&` `\|` `^`        | Bitwise AND, OR, XOR. Bitwise and shift results are 32-bit: unsigned when the operands are not negative (`$80000000 >> 4` is `$08000000`), signed (two's complement) when one is (`-8 >> 1` is `-4`). |
| `=` or `==`, `!=`   | Equality. Works on numbers and on strings.                                                                                                                                                            |
| `<` `<=` `>` `>=`   | Numeric comparison                                                                                                                                                                                    |
| `!` `&&` `\|\|`     | Logical NOT, AND, OR. The result is `1` (true) or `0` (false).                                                                                                                                        |
| `<` `>` (unary)     | Low byte and high byte of a 16-bit value                                                                                                                                                              |
| `+` on strings      | Concatenation: `"A" + "B"` is `"AB"`                                                                                                                                                                  |

Precedence follows [ca65](https://cc65.github.io/doc/ca65.html#ss5.5), from the tightest binding to the loosest. Operators on the same line are evaluated left to right.

1. Unary `-`, `<`, `>`, `!`
2. `*` `/` `%` `&` `^` `<<` `>>`
3. `+` `-` `|`
4. Comparisons: `=` `==` `!=` `<` `<=` `>` `>=`
5. `&&`
6. `||`

So `1 + 2 << 1` is `5` and `2 ^ 3 && 1` is `1`. Unlike ca65, `!` only applies to the value right after it: `!0 && 0` is `0`.

Parentheses group sub-expressions.

```as
addr = $1232
    lda #<addr  ; $32
    lda #>addr  ; $12
```

## Symbols and labels

### Labels

A label marks the current address. The colon is optional.

```as
loop:
    dex
    bne loop
exit
    rts
```

### Local labels

A label starting with `:` is local: it is only visible between two regular labels, so the same name can be reused.

```as
clear:
:loop   dex
        bne :loop
fill:
:loop   dey             ; another :loop
        bne :loop
```

The prefix can be another char: see [`.option local.prefix`](#assembler-settings).

### Anonymous labels

A lone `:` (followed by a space, a comment or the end of the line) defines an anonymous label. `:-` refers to the previous one and `:+` to the next one. Repeat the sign or add a number to go further: `:--`, `:++`, `:-3`. The marker can be another char: see [`.option anon.marker`](#assembler-settings).

```as
:   dex
    bne :-      ; back to the previous ':'
    beq :+      ; forward to the next ':'
    nop
:   rts
```

### Constants and variables

```as
WIDTH = 40              ; assignment
HEIGHT .equ 25          ; same, with .equ
SIZE = WIDTH * HEIGHT

.let "pos" + "X" = 10   ; .let accepts a name computed from a string expression: defines POSX
```

## Program counter and segments

`*` and `.pc` give the current address.

```as
.org $1000      ; set the program counter
* = $1000       ; same
    jmp * + 3
```

### Segments

Code is assembled into segments. The command line tool defines them in the project file (`input.segments`). They can also be defined in the source:

```as
.segment BOOT { start: $0800, end: $08FF }
.segment DATA { start: $2000, size: $100, pad: $FF }
```

`.segment <name>` selects a segment: the following code is assembled into it, starting at its start address the first time, and where it left off when the segment is selected again.

```as
.segment BOOT
    nop
```

### Modules

`.module <name>` starts a module, a group of segments for the [linker script](src/linker/linker_script.md#modules): the segments selected after it belong to it, until the next `.module`. The name is a symbol name or a string expression (`.module "LIB" + "1"`), and each module is defined once.

```as
.segment CODE { start: $8000, size: $100 }
.segment LIBCODE { start: $A000, size: $100 }

.module GAME
.segment CODE
    lda #1
.module LIB
.segment LIBCODE
    rts
```

The linker script writes a module's segments with `.WRITE MODULE "GAME"`. Without a linker script, modules change nothing: every segment is written.

- No segment can be selected before the first `.module` (`Segments were used before any module was defined.`). So modules only work with segments defined in the source: the project file's first segment is selected before the source starts.
- A segment selected in two modules belongs to both, and is written with each.

## Data

| Directive                                      | Emits                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `.db` / `.byte`                                | 8-bit values                                                                                    |
| `.dw` / `.word`                                | 16-bit values, in the CPU's byte order                                                          |
| `.dl` / `.long`                                | 32-bit values, in the CPU's byte order                                                          |
| `.fill` / `.ds` / `.res` `<count> [, <value>]` | `count` bytes of `value` (default `0`); `count` is a whole number, 0 or more                    |
| `.align <boundary> [, <value>]`                | `value` bytes (default `0`) up to the next multiple of `boundary`, which must be a power of two |
| `.hex`                                         | Bytes written as hexadecimal digits                                                             |
| `.incbin "<file>"`                             | The content of a binary file                                                                    |

The CPU's byte order is little-endian (`.dw $1234` gives `34 12`), except on the 6809, which is big-endian (`12 34`).

```as
.db $01, 2, "A"
.dw $1234           ; 34 12
.dl $01020304       ; 04 03 02 01
.fill 4, $EA        ; EA EA EA EA
.align $100         ; pad up to the next page

.hex
    0E 60 0B 00
    38 43 23 00
.end
.hex { 0E 60 0B 00 }
.hex 0E 60 0B 00
```

`.hex` data is digits only, in pairs, with optional spaces and comments: quoted strings are rejected.

`...` spreads an array in `.db`, `.dw` and `.dl`: each element is emitted as if it were written there. The array must be defined before the directive, where its number of elements places what follows.

```as
table = [2, 3]
.db 1, ...table, 4      ; 01 02 03 04
.dw ...[$1234, 5]       ; 34 12 05 00

.macro bytes ...values  ; a macro's rest parameter can be spread too
    .db ...values
.end
```

## Strings

| Directive                        | Emits                                                        |
| -------------------------------- | ------------------------------------------------------------ |
| `.text` / `.str` / `.string`     | The characters                                               |
| `.cstr` / `.cstring` / `.asciiz` | The characters, then a `0` byte                              |
| `.pstr`                          | A length byte, then the characters                           |
| `.pstrl`                         | A 16-bit length in the CPU's byte order, then the characters |

```as
.text "AB"      ; 41 42
.cstr "AB"      ; 41 42 00
.pstr "AB"      ; 02 41 42
.pstrl "AB"     ; 02 00 41 42
```

Each directive accepts several strings separated by commas, and `...` spreads an array of strings: `.cstr ...names` writes one string per element.

## Structured data: `.define`

`.define` loads structured data into a symbol, from a block or from a file. The block is parsed by a data processor: the command-line tool provides `YAML` (the default), `JSON` and `TEXT`. A library user registers their own (see the [README](README.md#library)).

Inside a YAML or JSON block, numbers follow that format's syntax: write `0xAA`, not `$AA`.

```as
.define sprites
    - { id: 0xAA, x: 0xA0, y: 0x10 }
    - { id: 0xBB, x: 0xB0, y: 0x20 }
.end
    lda #sprites[0].id

.define table AS JSON
    [1, 2, 3]
.end

.define levels from "levels.yml"
```

## Conditional assembly

```as
.if VERSION == 1
    lda #1
.else
    lda #2
.end

.if (.len(name) > 10) {
    .warning "name is too long"
} .else {
    .log "name is valid"
}
```

## Loops

`.repeat <count> [AS <iterator>]` repeats a block. The iterator counts from `1`. `count` is a whole number: `0` skips the block.

```as
.repeat 3 AS i
    .db i       ; 01 02 03
.end
```

`.for <item> of <array> [AS <index>]` repeats a block for each element of an array. The index counts from `0`.

```as
colours = ["red", "green", "blue"]
.for colour of colours AS idx
    .log idx, colour
.end
```

A loop only generates lines, as if the block were written out once per iteration: it has no scope of its own.

- What the block defines (labels, variables) stays after the loop, and a variable carries over to the next iteration.
- A label written in a block run more than once is defined more than once, which is an error: branch with [anonymous labels](#labels) (`:` and `:-`) instead.
- The iterators (`i`, `colour`, `idx`) are local to the loop, like macro parameters: after it, a symbol of the same name has its previous value again.

## Macros

```as
.macro print str
    ldx #<str
    ldy #>str
    jsr printString
.end

    print welcome
```

A macro name can only be defined once: defining it again is an error.

The parameters can also be written in parentheses, and the body in braces:

```as
.macro print(str) {
    ldx #<str
    ldy #>str
    jsr printString
}
```

An argument is a value: an expression, evaluated where the macro uses it, in an instruction as in a directive. An argument in `< >` is text, pasted as is: that's how an addressing mode is passed. `#` and a comma in `( )` are not in expressions, so `copy #10, $2001` or `copy ($12,x), $2001` are errors.

```as
.macro copy src, dst
    lda src
    sta dst
.end

    copy <table,x>, $2000   ; lda table,x / sta $2000
    copy <#10>, $2001       ; lda #10 / sta $2001
    copy <($12,x)>, $2002   ; lda ($12,x) / sta $2002
    copy 1+2, $2003         ; lda 3 / sta $2003: `lda src*2` would be lda 6
```

The arguments can also be written in parentheses, the `(` glued to the macro name: `copy(<#10>, $2001)`. With a space, the `(` starts the first argument: in `copy (1+2)*3, $2004`, `src` is 9.

An argument can't be empty: `copy 1,` or `m 1,,2` is an error. Empty text is written `<>`.

A last parameter written `...name` collects the remaining arguments into an array:

```as
.macro struct id, ...fields
    .dw id
    .for f of fields
        .dw f
    .end
.end

    struct $CAFE, $1234, $5678
```

## Functions

`.function <name>` … `.end` defines a routine whose labels stay local to it. Aliases: `.fn`, `.proc`, `.procedure`.

```as
.function clearScreen
    ldx #0
loop:               ; not visible outside clearScreen
    sta $0400, x
    dex
    bne loop
    rts
.end

    jsr clearScreen
```

## Namespaces

Symbols defined inside `.namespace <name>` … `.end namespace` belong to that namespace. Use `<namespace>::<symbol>` to reach them from outside. The default namespace is `global`.

```as
.namespace loader
    count = 5
.end namespace

    lda #loader::count
```

## Files

```as
.include "boot/loader.asm"  ; assemble another source file here
.incbin "data/logo.bin"     ; insert a binary file
```

An `.include` path is relative to the file that includes it. In a macro body, it's the file the macro is called from, not the one it's defined in: a macro is text, expanded where it's called (for a macro called in another macro's body, where the outermost one is called).

A file can be included several times: each `.include` assembles it again. A file of definitions (macros, constants) starts with `.once`: an `.include` of it after its `.once` was reached does nothing.

```as
; macros.asm
.once
.macro twice v
    .db v, v
.end
```

## Messages and listing

| Directive                                         | Effect                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `.log` / `.echo` / `.out` `<value> [, <value> …]` | Print the values, separated by tabs                                          |
| `.warning` / `.warn` `<value> [, <value> …]`      | Print a warning                                                              |
| `.error` / `.err` `<value> [, <value> …]`         | Stop the assembly with this error                                            |
| `.list on` / `.list off`                          | Turn the listing on or off (when the listing is enabled in the project file) |
| `.list file = "<name>"`                           | Write the listing of the current file to another file                        |

```as
.log "count = ", count
```

For columns that line up, build each line with `.pad()`: a tab moves to the next multiple of 8, so values of different lengths drift.

```as
.log .pad("#", -4) + .pad("Size", -7) + "Name"
.log .pad(.hex(id), -4) + .pad(.hex(size, 4), -7) + name   ; $02 $0200  WELCOME
```

## Assembler settings

| Directive                                        | Effect                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `.cpu "65C02"` (aliases `.setcpu`, `.processor`) | Select the CPU                                                                           |
| `.option local.prefix "<char>"`                  | Change the prefix of [local labels](#local-labels) (default `:`)                         |
| `.option anon.marker "<char>"`                   | Change the char of [anonymous labels](#anonymous-labels), alone or `-`/`+` (default `:`) |
| `.option listing.case "<case>"`                  | How the listing writes the instructions: `upper` (default), `lower` or `source`          |

The char is one of `:` `@` `!` `?` `_` `~`, and the two options can have different ones. Elsewhere, the char keeps its meaning: with `anon.marker "!"`, `!x` and `!=` are still operators.

`listing.case` applies to the mnemonics, registers and symbols of the listed instructions: `Sta Screen,x` is listed `STA SCREEN,X`, `sta screen,x`, or with `source` as written. Numbers are listed in hex.

An option takes effect from the next line on, in the rest of the file and in the files it includes. One set in an included file stays set after the `.include`. A macro body keeps the chars of where the macro is defined. In a block (`.if`, `.repeat`, …), an option takes effect after the block: its lines are read before they run.

The project file's `input.options` (or the `options` given to the `Assembler`) sets the values each source starts with. To include a source written for another assembler:

```as
.option local.prefix "@"    ; ca65's cheap local labels
.include "foreign.s"
.option local.prefix ":"
```

## System variables

Read-only values, prefixed with a dot.

| Variable                 | Value                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| `.pc` (or `*`)           | Current address                                                             |
| `.namespace` / `.ns`     | Current namespace                                                           |
| `.segment`               | Current segment, with `.segment.name`, `.segment.start` and `.segment.size` |
| `.filename`, `.filepath` | Current source file                                                         |
| `.pass`                  | Current assembler pass (`1` or `2`)                                         |

## System functions

| Function                                   | Returns                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.len(<array or string>)`                  | Its length                                                                                                                                                                                                                                                                                                                                                     |
| `.def(<symbol>)`, `.undef(<symbol>)`       | `1` if the symbol or macro is defined (`.def`) or not (`.undef`) at this point of the source, else `0`: one defined further down isn't yet. The name is written as is, `.def(X)`, never evaluated; in a macro, `.def(param)` checks the name passed. Any other expression gives the name: `.def("utils::getKey")`, `.def((name))` for the name held by `name`. |
| `.label(<name>)`                           | The address of the label with that name                                                                                                                                                                                                                                                                                                                        |
| `.type(<value>)`                           | `"number"`, `"string"`, `"array"` or `"object"`                                                                                                                                                                                                                                                                                                                |
| `.hex(<value> [, <digits>])`               | The value as a hexadecimal string: `.hex(10, 4)` is `"$000A"`. A negative value gives its two's complement: `.hex(-1)` is `"$FF"`                                                                                                                                                                                                                              |
| `.str(<value>)`                            | The value as a string                                                                                                                                                                                                                                                                                                                                          |
| `.pad(<value>, <width> [, <fill>])`        | The value (string or number) padded with `fill` (space by default) to `width` characters: on the left for a positive width, `.pad(25, 4)` is `"  25"`, on the right for a negative one, `.pad("AB", -4)` is `"AB  "`. A longer value is kept whole                                                                                                             |
| `.json(<value>)`                           | The value as a JSON string                                                                                                                                                                                                                                                                                                                                     |
| `.lobyte(<value>)`, `.hibyte(<value>)`     | Low byte, high byte                                                                                                                                                                                                                                                                                                                                            |
| `.floor(<n>)`, `.ceil(<n>)`, `.round(<n>)` | `n` rounded down, up, or to the nearest integer                                                                                                                                                                                                                                                                                                                |
| `.iif(<condition>, <then>, <else>)`        | `then` if the condition is not `0`, else `else`                                                                                                                                                                                                                                                                                                                |
| `.array(<item>, …)`                        | A new array                                                                                                                                                                                                                                                                                                                                                    |
| `.push(<array>, <item>, …)`                | The array, with the items added at the end                                                                                                                                                                                                                                                                                                                     |
| `.pop(<array>)`                            | The last item, removed from the array                                                                                                                                                                                                                                                                                                                          |
| `.split(<string> [, <separator>])`         | An array of the parts (separator: space by default)                                                                                                                                                                                                                                                                                                            |
| `.join(<array>, <separator>)`              | A string of the items joined by the separator                                                                                                                                                                                                                                                                                                                  |

## CPU

tsAsm assembles 65C02 code, with the usual syntax:

| Addressing mode                     | Example                      |
| ----------------------------------- | ---------------------------- |
| Implied / accumulator               | `inx`, `asl a`               |
| Immediate                           | `lda #$12`                   |
| Zero page / absolute                | `lda $12`, `lda $1234`       |
| Indexed                             | `lda $12,x`, `lda $1234,y`   |
| Indirect                            | `jmp ($1234)`, `lda ($12)`   |
| Indexed indirect / indirect indexed | `lda ($12,x)`, `lda ($12),y` |
| Relative                            | `bne loop`                   |

A `.b` or `.w` suffix forces the addressing mode of an address, whatever its value. Without one, an address that fits in the zero page uses it.

- `.b` uses zero page, with the address's low byte: with `X = $1234`, `lda.b X` is `lda $34` (`a5 34`).
- `.w` uses absolute: with `X = $10`, `lda.w X` is `lda $0010` (`ad 10 00`).
- A suffix only applies to an address that can be zero page or absolute: `nop.b`, `lda.w #1` or `lda.b ($10),y` are errors, and so is a form the instruction doesn't have (`jmp.b`, `lda.b $10,y`).

Suffixes work on the 6502 and the 65C02; other CPUs have none.
