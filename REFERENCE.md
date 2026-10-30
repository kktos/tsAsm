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
- [Procedures](#procedures)
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

- Directives start with a dot: `.db`, `.macro`, … Their names are case-insensitive. The dot is glued to the name, and the name is followed by a space, the end of the line or a comment: `.db $41`, not `. db $41` or `.db$41`. A [system function](#system-functions) is written with its `(` glued, `.str("A")`, so it's never read as a directive: `.str("A")` can't start a statement, but `.str ("A")` is the `.str` directive.
- Symbol names are case-insensitive: `Loop` and `LOOP` are the same symbol.
- Outside comments and strings, a character the assembler doesn't recognise is an error, even in code that isn't assembled (a false `.if`). A byte order mark at the start of a file is ignored.
- Blocks (`.if`, `.repeat`, `.for`, `.macro`, `.proc`, `.define`, …) end with `.end`, or can be written with braces:

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

Strings use double or single quotes: `"Hello"` or `'Hello'`. A string ends on its line: a missing closing quote is an error. A one-character string used as a number is its character code, on every CPU: `lda #"A"` loads `$41`, `"A"+1` is `$42`, `$80|"H"` is `$C8`, and `"9"-"0"` is `9`. Between two strings, `+` still joins them and `=`, `==`, `!=` compare their text: `"A"+"B"` is `"AB"`. A longer string is never a number: `"AB"+1` is an error.

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

`.range()` and `.map()` build an array in one expression, without a loop: see [Building an array](#building-an-array).

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
| `^` (unary)         | Bank byte, bits 16–23 of a 24-bit address: `lda #^table`. Unary where an operand starts, XOR after one: `1 ^ ^table` is `1` XOR the bank byte, as `<` and `>` are also comparisons.                   |
| `+` on strings      | Concatenation: `"A" + "B"` is `"AB"`                                                                                                                                                                  |

Precedence follows [ca65](https://cc65.github.io/doc/ca65.html#ss5.5), from the tightest binding to the loosest. Operators on the same line are evaluated left to right.

1. Unary `-`, `<`, `>`, `^`, `!`
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

An expression can't be empty: `lda #`, `lda ,x`, `x =`, `.org`, `.db 1,`, `[1,,2]` or `.array(1,)` with nothing where the value goes is an error, `Missing expression.`, not `0`.

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
HEIGHT .equ 25          ; a constant
WIDTH = 40              ; a variable
SIZE = WIDTH * HEIGHT

.let "pos" + "X" = 10   ; a variable too, its name computed from a string expression: defines POSX
```

`.equ` defines a constant, and so does a label: it can't be defined again (`Symbol 'HEIGHT' redefined.`), and `=` can't change it (`Can't redefine constant 'HEIGHT'.`).

`=` and `.let` assign a variable: it can be assigned again, and a use has the value of the last assignment before it.

```as
count = 1
    .db count           ; 01
count = count + 1
    .db count           ; 02
```

A constant, or a variable assigned once, can be used before it's defined. A variable assigned more than once can't: its value there is ambiguous, so `.db v` / `v = 1` / `v = 2` is an error (`Variable 'V' is used before it's assigned, and it's assigned more than once: its value here is ambiguous.`). Assign it before using it.

## Program counter and segments

`*` and `.pc` give the current address.

```as
.org $1000      ; set the program counter
* = $1000       ; same
    jmp * + 3
```

The program counter stays in the CPU's address space: 16 bits on the 6502, 65C02 and 6809, 32 on the RV32I. An address outside it is an error, never wrapped: `.org $10000` on the 6502 is `Address $10000 is outside the 6502's address space ($0..$FFFF).`, and so is a negative one. Code can end at the top of it, with its last byte at `$FFFF`, but not go past it: a statement whose bytes do, an instruction, data, `.fill`, is an error (`The PC goes past $FFFF, the top of the 6502's address space, to $10001.`). So is `.cpu` switching to a CPU the PC is past the top of.

### Segments

Code is assembled into segments. The command line tool defines them in the project file (`input.segments`). They can also be defined in the source:

```as
.segment BOOT { start: $0800, end: $08FF }
.segment DATA { start: $2000, size: $100, pad: $FF }
```

A segment needs a `start`, and an `end` or a `size`, not both: a `size` of `0` makes one that grows as code is written to it. Each key is given once, in any case: `start` and `START` are the same key.

A relocatable segment has no address until it's loaded: it's declared with `relocatable: true` (or `reloc: true`), and has no `start` nor `end`, which are errors. Its `size` is optional: without one, it grows. `.org` and `* =` are errors in it. Only a [linker script](src/linker/linker_script.md) can place it: linking without one is an error (`Segment 'CODE' is relocatable: it needs a linker script to place it.`).

```as
.segment CODE { relocatable: true }
.segment TABLES { reloc: true, size: $100 }
```

Any other key is an attribute: the assembler doesn't read it, it keeps it for the [linker script](src/linker/linker_script.md), which reads it as `seg.attrs.<key>` (an output format's segment kind, its load name…: see the [OMF library](src/linker/linker_script.md#apple-iigs-omf-output)). Its key is in lowercase, `KIND` and `kind` being the same, given once; its value is a number or a string, an expression of symbols defined before the `.segment`. A misspelled key, `sise: 4`, is an attribute too, not an error. The project file's `input.segments` take them the same way.

```as
.segment CODE { reloc: true, kind: $1000, loadname: "MAIN" }
```

Its labels, `*` and `.PC` in it are relocatable values: a segment and an offset from its start, `CODE+$0012`, not a number. In expressions:

- `label + n`, `n + label` and `label - n` are relocatable;
- `end - start`, two labels of the same segment, is a number; of two segments, an error;
- `<label`, `>label`, `^label`, and `.lobyte()`, `.hibyte()`, `.bankbyte()`, are one byte of it, still relocatable (`>CODE+$0012`);
- anything else is an error, as its address is only known when it's loaded: `label * 2`, `label & $FF`, a comparison, `-label`, `.hex(label)`, and a relocatable value where a number is needed (`.if`, `.assert`, `.repeat`, `.fill`, `.align`, `.org`, a segment's bounds).

A variable or a constant can hold one (`next = label + 2`), an array too, and `.iif()` can give one. Its fields are numbers and strings, known before it's loaded: `label.segment` is its segment's name (`"CODE"`), `label.offset` its offset there (`$12`). Any other field is an error, and so is a field of one byte of it (`x = >label` / `x.offset`).

Written in the code or the data, a relocatable value is its offset, and a fixup is recorded where it goes: the loader adds its segment's address there. Each segment keeps its fixups in `relocs`, which the linker script reads as `seg.relocs`: `{ offset, size, shift, segment, targetOffset }`, where its bytes are in the segment, how many, how many bits the address is shifted right (0, 8 for `>`, 16 for `^`), and the segment and offset of the value.

- **Data:** `.dw label` and `.dl label` record the element's 2 or 4 bytes. `<`, `>` and `^` give one byte: `.db >label`, and `.dw <label`, the byte then 0, its fixup on that byte. A whole address in a `.db` is an error: `.DB value: CODE+$0012 is a whole address: take one byte of it with <, > or ^.`
- **6502 and 65C02 operands:** a relocatable address is absolute, never zero page whatever its offset, with a fixup of 2 bytes: `jmp label`, `lda label,x`, `jmp (label)`. An immediate takes one byte: `lda #<label`, `lda #>label`; `lda #label` is an error. A relocatable address can't be in zero page: `lda (label),y`, `lda.b label`, `stx label,y` are errors.
- **Branches:** a branch target is an address in the branch's own segment. In a relocatable one, `bne loop` is the distance between their offsets, without a fixup. A branch to another segment, or from a relocatable segment to a fixed address, is an error: `A branch from relocatable segment 'CODE' can't reach $1000: the distance is only known when it's loaded.`
- **Other CPUs:** their operands can't take a relocatable value yet: `CODE+$0012 is relocatable, and the 6809's operands can't take one: their fixups aren't recorded.`

The listing shows a relocatable label as its segment and offset (`CODE+0012     main:`), the [symbol file](README.md#symbol-file) with the type `reloc`.

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

A string is its characters, one value each: `.db "AB"` is `.db "A", "B"`, and `.dw "AB"` is `.dw "A", "B"`, `41 00 42 00`. A character above 255 is an error.

```as
.db $01, 2, "A"
.dw $1234           ; 34 12
.dl $01020304       ; 04 03 02 01
.dw "AB"            ; 41 00 42 00
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

.db ... .map(.range(0, 4), .lobyte)    ; an array built in the directive, see .map()
```

`... .map(…)` is easier to read with its space: `....map(…)` is the same, `...` then `.map`.

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

`.define` isn't the `.define` of ca65 nor C's `#define`: it doesn't define text that replaces its name where it's used. For that, write a [macro](#macros) or a [function](#functions).

Inside a YAML or JSON block, numbers follow that format's syntax: write `0xAA`, not `$AA`. A boolean is read as 1 or 0, the assembler has no boolean: `true` is 1, `!cfg.debug` with `debug: true` is 0.

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

`.if <condition>`, then any number of `.elseif <condition>`, then an optional `.else`. The first branch whose condition is true is assembled, or the `.else` branch when none is. A condition is evaluated only while no branch before it was taken: after a true one, the next conditions aren't read.

```as
.if VERSION == 1
    lda #1
.elseif VERSION == 2
    lda #2
.else
    lda #3
.end

.if (.len(name) > 10) {
    .warning "name is too long"
} .elseif (.len(name) == 0) {
    .error "name is empty"
} .else {
    .log "name is valid"
}
```

A branch not taken isn't assembled, but it's checked: an unknown character is an error (see [Source format](#source-format)), and so is an unknown directive starting a statement, at the start of a line, after a label or after a brace (`.if 0` / `.foobar` / `.end`). `.else` is the last branch: an `.elseif` or a second `.else` after it is an error. Link scripts have the same `.if`.

## Loops

`.repeat <count> [AS <iterator> [FROM <start>]]` repeats a block. `count` is a whole number: `0` skips the block. The iterator counts from `1`, or from `start`.

```as
.repeat 3 AS i
    .db i       ; 01 02 03
.end
.repeat 3 AS i FROM 0
    .db i       ; 00 01 02
.end
```

`.for <item> of <array> [AS <index> [FROM <start>]]` repeats a block for each element of an array. The index counts from `0`, or from `start`: the items always start at the array's first. Over numbers, [`.range()`](#building-an-array) gives the array: `.for x of .range(0, 8, 2)` runs with `x` at 0, 2, 4 and 6.

```as
colours = ["red", "green", "blue"]
.for colour of colours AS idx
    .log idx, colour    ; idx: 0, 1, 2
.end
.for colour of colours AS idx FROM 1
    .log idx, colour    ; idx: 1, 2, 3
.end
```

`start` is a whole number, negative too, from an expression whose symbols are defined before the loop. Without `FROM`, the iterator starts at the value of the [local option](#global-and-local-options) `repeat.start` or `for.start`: `1` and `0` unless changed. `FROM` needs `AS`, and nothing else can end the header: `.repeat 3 AS i, j` and `.repeat 3 FROM 0` are errors.

A loop only generates lines, as if the block were written out once per iteration: it has no scope of its own.

- What the block defines (labels, variables) stays after the loop, and a variable carries over to the next iteration.
- A label written in a block run more than once is defined more than once, which is an error: branch with [anonymous labels](#labels) (`:` and `:-`) instead.
- The iterators (`i`, `colour`, `idx`) are local to the loop, like macro parameters: after it, a symbol of the same name has its previous value again.

`.break` ends the innermost loop it's in, with the iterations left: what follows in its block isn't assembled, but its directives are checked as in a branch not taken. It also ends what it's in within the loop, an `.if` branch for instance. What the iterations already run defined stays, and the iterators get their previous value back, as at the loop's normal end. Anywhere else, at the top level, in a `.proc` out of a loop, in a macro whose body has no loop around it (even if the macro is called from a loop) or in a file included from a loop, it's an error.

```as
.for c of chars
    .if c == 0
        .break
    .end
    .db c
.end
```

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

An argument is a value: an expression, evaluated where the macro uses it, in an instruction as in a directive. An argument in `{ }` is text, pasted as is: that's how an addressing mode is passed, as in ca65. `<` and `>` are low and high byte, as in any expression: `setp <addr, >addr`. `#` and a comma in `( )` are not in expressions, so `copy #10, $2001` or `copy ($12,x), $2001` are errors.

```as
.macro copy src, dst
    lda src
    sta dst
.end

    copy {table,x}, $2000   ; lda table,x / sta $2000
    copy {#10}, $2001       ; lda #10 / sta $2001
    copy {($12,x)}, $2002   ; lda ($12,x) / sta $2002
    copy 1+2, $2003         ; lda 3 / sta $2003: `lda src*2` would be lda 6
```

The arguments can also be written in parentheses, the `(` glued to the macro name: `copy({#10}, $2001)`. With a space, the `(` starts the first argument: in `copy (1+2)*3, $2004`, `src` is 9.

An argument can't be empty: `copy 1,` or `m 1,,2` is an error. Empty text is written `{}`.

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

`.exitmacro` (alias `.exitm`) ends the macro's expansion: what follows in its body isn't assembled, but its directives are checked as in a branch not taken. It also ends what it's in within the body, an `.if` branch or a loop, with all its iterations. In a macro called from another one, it ends only the inner one. Anywhere else, at the top level, in a `.proc` or in a file included from a macro, it's an error.

```as
.macro ldax value
    .if value == 0
        lda #0
        tax
        .exitmacro
    .end
    lda #<value
    ldx #>value
.end
```

## Functions

`.function <name>(<parameters>) = <expression>` (alias `.fn`) defines a function, which an expression calls as `name(…)` and which gives the value of its expression. Without the `=`, its body is a block of statements, in `{ }` or up to `.end`, and `.return <expression>` gives the value:

```as
.function screen(col, row) = $0400 + row*40 + col
.function sq(x) = x * x

    sta screen(10, 5)   ; sta $04D2
.repeat 4 AS i FROM 0
    .db sq(i)           ; 00 01 04 09
.end

.function reverse(b) {
    r = 0
    .repeat 8 AS i {
        r = (r << 1) | ((b >> (i - 1)) & 1)
    }
    .return r
}

    .db reverse($0F)    ; F0
```

- **A call** is the name with its `(` glued to it, as a macro's `m(1, 2)`: `screen (10, 5)` is the name followed by an expression, and a function's name without a call is an error (`'screen' is a function: call it, screen(…).`), except as the function [`.map()`](#building-an-array) calls. From another namespace: `gfx::line(2)`. The system functions keep their dot, `.len()`, so they never have the same name.
- **The arguments are values**, evaluated at the call, unlike a macro's: with `.function double(x) = x * 2`, `double(1 + 2)` is 6. There must be as many as there are parameters; `f()` is a call without arguments.
- **A scope per call:** the parameters are local to it, and hide a symbol of the same name. The expression reads the symbols of where the function is defined, with the values they have at the call, and `*` is the address of the call. It doesn't see the parameters and variables of the macro it's called from. Defined in a macro's body, it sees that macro's parameters, with the arguments of the call that defined it: in `.macro m base` / `.function f(x) = base + x`, `m 5` gives a `f(1)` of 6. A parameter of the function hides a macro parameter of the same name, and a rest parameter's element can be chosen by one: `.function f(i) = p[i]`.
- **Defined before its call:** a call above the `.function` line is `Unknown function 'f'.`, in both passes, as `.def()` says.
- **A name like a symbol's:** a function and a symbol (a label, a constant, a variable) can't have the same name (`Symbol 'F' redefined.`), and a function is defined once. In a loop, which [generates lines](#loops), a `.function` is defined again at each iteration: an error. Functions aren't in the symbol file.
- **An error in the expression or the body** is located at the call, with a note at its place in the function: `note: in function f`.

### A function's body

A body only computes its value. It can have:

- assignments, `=` and `.let`: the variables are the call's, even when a symbol outside has the same name. That one is read until the body assigns the name, and doesn't change: with `x = 1`, a body's `x = x + 1` gives 2 at each call, and `x` stays 1. `.let` doesn't reach out of the call either, as it does out of a macro's: `.let "ns::x"` is an error;
- `.if` / `.elseif` / `.else`, `.repeat`, `.for` and `.break`;
- `.return <expression>`, which ends the call with that value. What follows isn't run. A body that ends without one is an error (`Function 'f' ends without .return.`), as is a `.return` out of a function;
- `.error`, `.warning`, `.log` and `.assert`.

Anything else is an error when a call runs it: an instruction, a label, a macro call, data, `.org`, `*`, `.segment`, `.equ`, `.option`, `.include`, a `.function`… (`Instruction 'lda' can't be in a function: a function only computes a value.`). The body runs with the [local options](#global-and-local-options) of where the function is defined, as a macro body does, and isn't listed: the listing shows the line calling it.

```as
.function first(list, limit) {
    .for item of list {
        .if item > limit {
            .return item
        }
    }
    .error "nothing above ", limit
}
```

### Recursion

A function can call another, and itself through another or directly: a block's `.if` ends the recursion.

```as
.function fact(n) {
    .if n <= 1 {
        .return 1
    }
    .return n * fact(n - 1)
}
```

How deep a function can call itself is the `.option function.recursion` (default `64`, from `0`, never, to `256`), a [global option](#global-and-local-options): past it, `Function 'f' calls itself more than 64 deep (.option function.recursion).` Calls of other functions and calls one after the other don't count: `inc(inc(x))` is no recursion.

Without parentheses, `.function clearScreen` is an error that says to write [`.proc`](#procedures), what it used to be.

## Procedures

`.proc <name>` … `.end` defines a routine whose labels stay local to it. Alias: `.procedure`.

```as
.proc clearScreen
    ldx #0
loop:               ; not visible outside clearScreen
    sta $0400, x
    dex
    bne loop
    rts
.end

    jsr clearScreen
```

`.function` and `.fn` were aliases: they now define [functions](#functions), and without parentheses they are an error that says to write `.proc`.

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

An `.include` or `.incbin` path is relative to the file it is in. In a macro body, it's the file the macro is called from, not the one it's defined in: a macro is text, expanded where it's called (for a macro called in another macro's body, where the outermost one is called).

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
| `.assert <condition> [, warn] [, <value> …]`      | Stop the assembly when the condition is false, or only warn: see below       |
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

`.assert` checks a condition in pass 2, when every symbol is known, so it can use labels defined after it. A false condition stops the assembly with the values as the error, `Assertion failed` without any. With `warn` (or `warning`) as its second argument, a word alone in any case, it's a warning and the assembly goes on; `err` (or `error`) is the default. Any other second argument is the start of the message.

```as
.assert end - start <= $100, "the code is ", end - start, " bytes"
.assert .len(name) <= 10, warn, "name is too long"
```

## Assembler settings

| Directive                                      | Effect                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `.cpu 65C02` (aliases `.setcpu`, `.processor`) | Select the [CPU](#selecting-the-cpu)                                                     |
| `.option local.prefix "<char>"`                | Change the prefix of [local labels](#local-labels) (default `:`)                         |
| `.option anon.marker "<char>"`                 | Change the char of [anonymous labels](#anonymous-labels), alone or `-`/`+` (default `:`) |
| `.option listing.case "<case>"`                | How the listing writes the instructions: `upper` (default), `lower` or `source`          |
| `.option listing.data "<mode>"`                | How the listing writes [data and loops](#listing-data): `expand` (default) or `fold`     |
| `.option repeat.start <n>`                     | Where a [`.repeat`](#loops) iterator without `FROM` starts: `0` or `1` (default `1`)     |
| `.option for.start <n>`                        | Where a [`.for`](#loops) index without `FROM` starts: `0` or `1` (default `0`)           |
| `.option function.recursion <n>`               | How deep a [function](#functions) can call itself: `0` to `256` (default `64`)           |

The char is one of `:` `@` `!` `?` `_` `~`, and the two options can have different ones. Elsewhere, the char keeps its meaning: with `anon.marker "!"`, `!x` and `!=` are still operators.

`listing.case` applies to the mnemonics, registers and symbols of the listed instructions: `Sta Screen,x` is listed `STA SCREEN,X`, `sta screen,x`, or with `source` as written. Numbers are listed in hex.

### Listing data

`listing.data` is about the data: `.db`, `.dw`, `.dl` and the other data directives, `.hex`, `.text` and the string directives, `.fill`, `.align` and `.incbin`. With `expand`, every byte is listed, 8 per line, the statement's text on the first line. With `fold`, only the first line is listed, a `…` after its bytes when more follow, and a text longer than 48 chars is cut with a `…`:

```
1004: 05 06 07 08 09 0A 0B 0C  …                  .db $05, $06, $07, $08, $09, $0A, $0B, $0C, $0D…
1018: 00 11 22 33 44 55 66 77  …                  .hex <20 bytes>
```

A `.repeat` or a `.for` is listed as its header, then its lines as they ran, iteration by iteration. With `fold`, a loop that only emits data, one block of it, is listed as one data statement, its header as the text: `.repeat 128 AS idx FROM 0` / `.db (idx % 16) * 16` / `.end` gives one line. A loop that does more (an instruction, an assignment, a `.log`) is listed line by line, its data folded:

```
1000: 00 10 20 30 40 50 60 70  …                  .repeat $80 AS idx FROM $00
```

Instructions are always listed whole.

### Global and local options

The project file's `input.options` (or the `options` given to the `Assembler`) sets the values the source starts with; a value given on the command line (`-O listing.data=fold`, see [README](README.md#command-line)) overrides it. Then `.option` changes a value, and how far the change reaches depends on the kind of option.

**Global options**: `local.prefix`, `anon.marker`, `listing.case`, `listing.data` and `function.recursion`. They are about how the source is read, or how far the assembler goes, so they follow the reading order:

- An option takes effect from the next line on, in the rest of the file and in the files it includes. One set in an included file stays set after the `.include`.
- A macro body keeps the chars of where the macro is defined.
- In a block (`.if`, `.repeat`, …), an option takes effect after the block: its lines are read before they run.

To include a source written for another assembler:

```as
.option local.prefix "@"    ; ca65's cheap local labels
.include "foreign.s"
.option local.prefix ":"
```

**Local options**: `repeat.start` and `for.start`. They are about what the code means, so each file decides for itself, and its loops count the same wherever it's included:

- Each file starts with the values the assembler was given, not with its includer's.
- An option takes effect from the next statement on, until the end of its file: after an `.include`, the includer's values are back.
- A macro body runs with the values of where the macro is defined, not of where it's called. An `.option` in the body lasts until the end of the call.
- In a block, an option takes effect from the next statement, as the block runs: a `.repeat` after it, in the block, uses it.

```as
; lib.s
.macro table n
    .repeat n AS i
        .db i
    .end
.end

; main.s
.option repeat.start 0
.include "lib.s"        ; lib.s starts with repeat.start 1
    table 3             ; 01 02 03: the start of where table is defined
.repeat 3 AS i          ; back in main.s, repeat.start 0
    .db i               ; 00 01 02
.end
```

To set a local option for the whole project, give it in the project file.

### Selecting the CPU

The CLI has the CPUs `6502`, `65C02`, `6809` and `RV32I`; a program using the library gives the assembler its own (see [README](README.md#library)). The project file's `input.cpu` selects the one the source starts with (`6502` by default), and `.cpu` changes it for the lines after it. The names are in any case, and an unknown one is an error that lists them: `Unknown CPU name '65816': the CPUs are 6502, 6809, 65C02, ARM_RISC, RV32I.` (the CLI's)

A word alone after `.cpu` is the CPU's name: `.cpu 65C02`, `.cpu rv32i`. Anything else is a string expression giving it: `.cpu "65C02"`, or a symbol in parentheses.

```as
TARGET = "65C02"
.cpu (TARGET)       ; the CPU named by TARGET
.cpu TARGET         ; error: Unknown CPU name 'TARGET': …
```

To choose the CPU depending on a condition, use `.iif()` (or `.if`). The CPU is needed from pass 1 on, so the symbols must be defined before the `.cpu`.

```as
C02 = 1
.cpu .iif(C02, "65C02", "6502")
```

A CPU can have directives of its own, as the 65816 will have `.a16`. They are known whatever the CPU, so a block not assembled can hold them, and they run only while their CPU is the current one: under another, `.a16` is an error, `'.a16' is a 65816 directive: the current CPU is 6502.` What a CPU keeps (the 65816's accumulator width) starts as after reset at each pass, and is kept across `.cpu`: `.cpu 6502` then `.cpu 65816` finds it as it was left.

## System variables

Read-only values, prefixed with a dot glued to the name: `.pc`, not `. pc`.

| Variable                 | Value                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| `.pc` (or `*`)           | Current address                                                             |
| `.namespace` / `.ns`     | Current namespace                                                           |
| `.segment`               | Current segment, with `.segment.name`, `.segment.start` and `.segment.size` |
| `.filename`, `.filepath` | Current source file                                                         |
| `.pass`                  | Current assembler pass (`1` or `2`)                                         |

## System functions

A call is the dot, the name and the `(` glued: `.len("AB")`. `.len ("AB")` and `. len("AB")` are errors.

| Function                                   | Returns                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.len(<array or string>)`                  | Its length                                                                                                                                                                                                                                                                                                                                                               |
| `.def(<symbol>)`, `.undef(<symbol>)`       | `1` if the symbol, function or macro is defined (`.def`) or not (`.undef`) at this point of the source, else `0`: one defined further down isn't yet. The name is written as is, `.def(X)`, never evaluated; in a macro, `.def(param)` checks the name passed. Any other expression gives the name: `.def("utils::getKey")`, `.def((name))` for the name held by `name`. |
| `.label(<name>)`                           | The address of the label with that name                                                                                                                                                                                                                                                                                                                                  |
| `.has(<object>, <key>)`                    | `1` if the object has the field `key`, a string, as written (`.has(cfg, "kind")`), else `0`                                                                                                                                                                                                                                                                              |
| `.type(<value>)`                           | `"number"`, `"string"`, `"array"` or `"object"`                                                                                                                                                                                                                                                                                                                          |
| `.hex(<value> [, <digits>])`               | The value as a hexadecimal string: `.hex(10, 4)` is `"$000A"`. A negative value gives its two's complement: `.hex(-1)` is `"$FF"`                                                                                                                                                                                                                                        |
| `.str(<value>)`                            | The value as a string                                                                                                                                                                                                                                                                                                                                                    |
| `.pad(<value>, <width> [, <fill>])`        | The value (string or number) padded with `fill` (space by default) to `width` characters: on the left for a positive width, `.pad(25, 4)` is `"  25"`, on the right for a negative one, `.pad("AB", -4)` is `"AB  "`. A longer value is kept whole                                                                                                                       |
| `.json(<value>)`                           | The value as a JSON string                                                                                                                                                                                                                                                                                                                                               |
| `.lobyte(<value>)`, `.hibyte(<value>)`     | Low byte, high byte                                                                                                                                                                                                                                                                                                                                                      |
| `.bankbyte(<value>)`, `.bkbyte(<value>)`   | Bank byte, bits 16–23, as unary `^`                                                                                                                                                                                                                                                                                                                                      |
| `.floor(<n>)`, `.ceil(<n>)`, `.round(<n>)` | `n` rounded down, up, or to the nearest integer                                                                                                                                                                                                                                                                                                                          |
| `.iif(<condition>, <then>, <else>)`        | `then` if the condition is not `0`, else `else`                                                                                                                                                                                                                                                                                                                          |
| `.array(<item>, …)`                        | A new array                                                                                                                                                                                                                                                                                                                                                              |
| `.push(<array>, <item>, …)`                | The array, with the items added at the end                                                                                                                                                                                                                                                                                                                               |
| `.pop(<array>)`                            | The last item, removed from the array                                                                                                                                                                                                                                                                                                                                    |
| `.range(<start>, <count> [, <step>])`      | An array of `count` numbers from `start`, `step` apart (1 by default): see [Building an array](#building-an-array)                                                                                                                                                                                                                                                       |
| `.map(<array>, <function>)`                | A new array, of the function's value for each element: see [Building an array](#building-an-array)                                                                                                                                                                                                                                                                       |
| `.split(<string> [, <separator>])`         | An array of the parts (separator: space by default)                                                                                                                                                                                                                                                                                                                      |
| `.join(<array>, <separator>)`              | A string of the items joined by the separator                                                                                                                                                                                                                                                                                                                            |

### Building an array

`.range(<start>, <count> [, <step>])` gives `count` numbers from `start`, `step` apart: `.range(0, 4)` is `[0, 1, 2, 3]`, `.range(1, 3)` is `[1, 2, 3]`, `.range(0, 4, 2)` is `[0, 2, 4, 6]`, `.range(5, 3, -1)` is `[5, 4, 3]`. The second argument is a count, as `.repeat`'s, not an end: the array has that many elements. All three are whole numbers, the count `0` or more (`0` gives `[]`), the step not `0`.

`.map(<array>, <function>)` calls the function with each element and gives the array of its values. The function is written by its name, not called: a [user function](#functions) defined before (`row`), or a system function with its dot (`.lobyte`). It must take one argument.

```as
.fn row(c) = c * 16
.db ... .map(.range(0, 16), row)   ; 00 10 20 … F0

addrs = [reset, nmi, irq]
lo: .db ... .map(addrs, .lobyte)   ; a table of addresses, split
hi: .db ... .map(addrs, .hibyte)
```

In a macro, a parameter can give the function, by its name: `table [1, 2], double` or `table list, .hibyte` with `.db ... .map(list, fn)` in the body. An unknown name, a symbol that isn't a function or one that doesn't take one argument is an error, even for an empty array: `.MAP() calls its function with one argument, each element: 'f' takes 2.`

## CPU

tsAsm assembles 65C02 code (WDC's W65C02S: with Rockwell's bit instructions, and `stp` / `wai`), with the usual syntax:

| Addressing mode                     | Example                      |
| ----------------------------------- | ---------------------------- |
| Implied / accumulator               | `inx`, `asl a`               |
| Immediate                           | `lda #$12`                   |
| Zero page / absolute                | `lda $12`, `lda $1234`       |
| Indexed                             | `lda $12,x`, `lda $1234,y`   |
| Indirect                            | `jmp ($1234)`, `lda ($12)`   |
| Indexed indirect / indirect indexed | `lda ($12,x)`, `lda ($12),y` |
| Relative                            | `bne loop`                   |
| Zero page and relative              | `bbr0 $12,loop`              |

The 6502 reads the same syntax, without the 65C02's instructions and modes. On both:

- `asl` alone is `asl a`.
- An operand that doesn't fit is an error, never truncated: an immediate in a byte (`-128..255`), an address in 16 bits, the address in `($12,x)`, `($12),y`, `($12)`, `rmb0 $12` and `bbr0 $12,loop` in the zero page.
- An operand is an indirect mode when its first `(` closes at its end, `($12)` or `($12,x)`, or right before `,y`: `($12),y`. Otherwise its parentheses only group an expression: `lda (2+3)*4` is `lda $14`, `lda (1)+(2),y` is `lda $0003,y`. `lda ($12),x` is an error, not `lda $12,x`: it is most likely a typo for `($12,x)`.
- The same goes for `[`: an operand whose first `[` closes at its end, or right before `,y` or `,x`, is a bracket mode, `[$12]`, `[$12],y`, which neither CPU has: an error. Otherwise it's an expression: `lda [1,2][1]` is `lda $02`, `lda [$12]+1` is an error, as an array plus a number is.

A `.b` or `.w` suffix forces the addressing mode of an address, whatever its value. Without one, an address that fits in the zero page uses it.

- `.b` uses zero page, with the address's low byte: with `X = $1234`, `lda.b X` is `lda $34` (`a5 34`).
- `.w` uses absolute: with `X = $10`, `lda.w X` is `lda $0010` (`ad 10 00`).
- A suffix only applies to an address that can be zero page or absolute: `nop.b`, `lda.w #1` or `lda.b ($10),y` are errors, and so is a form the instruction doesn't have (`jmp.b`, `lda.b $10,y`).

Suffixes work on the 6502 and the 65C02; other CPUs have none.
