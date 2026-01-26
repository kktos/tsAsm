# Linker Script Documentation

The Linker Script allows you to control the layout of the final binary output by defining how input segments (from the assembler) are combined, placed, and padded.

## Basic Syntax

The linker script supports standard assembler syntax for comments and expressions.

- **Comments**: Start with `#`.
- **Labels**: Defined as `Label:` or `Label`.
- **Expressions**: Standard math operations are supported.

## System Variables

The following variables are available within the linker script:

- `PC`: The current Program Counter (offset within the current active segment).
- `FILENAME`: The name of the output file.
- `IMAGE_END`: The current end of the image (size or data length).
- `segments`: An array containing all input segments provided by the assembler.

## Directives

### OUTPUT
Defines the output file properties.

```asm
OUTPUT "filename" [FIXED size [PAD value] | MAX size]
```

- `FIXED`: Enforces a fixed size for the output file.
- `PAD`: The value used to pad the file if it is smaller than the fixed size (default 0).
- `MAX`: Ensures the output file does not exceed a specific size.

### ENDIAN
Sets the endianness for subsequent multi-byte writes.

```asm
ENDIAN <BIG | LITTLE>
```

### SEGMENT (Linker Segment)
Defines a specific region in the output file at a given offset. This creates a "linker segment" that acts as a buffer. When this directive is used, subsequent write operations (like `WRITE BYTE`) will target this region.

```asm
SEGMENT Name AT offset
```

*Note: This is different from the `WRITE SEGMENT` command. This directive defines a writing context at a specific absolute offset in the final file.*

### WRITE
Writes data or input segments into the current context.

```asm
WRITE <type> <value> [AT <offset>]
```

Supported types:
- `BYTE`: Write a single byte (0-255).
- `WORD`: Write a word (2 bytes).
- `LONG`: Write a long (4 bytes).
- `BYTES`: Write an array of bytes.
- `STRING`: Write a string (ASCII).
- `SEGMENT`: Appends an entire input segment (from the assembler) to the end of the output file.

*Note: `WRITE SEGMENT` currently appends to the final output stream, ignoring the current `SEGMENT ... AT` context.*

### Standard Directives
The linker supports several standard assembler directives:

- `ALIGN <alignment> [value]`: Aligns the PC to the next multiple of `alignment`.
- `FILL <count> [value]`: Fills `count` bytes with `value`.
- `BYTE`, `WORD`, `LONG`: Aliases for writing raw data (similar to `WRITE BYTE` etc).
- `STRING`, `PSTRING`, `CSTRING`: Write strings.
- `IF <condition> ... END`: Conditional execution.
- `FOR <var> = <start> TO <end> ... REPEAT`: Loops.
- `LOG`, `WARNING`, `ERROR`: Output messages to the console.

## Example

```asm
# Set output file
OUTPUT "game.rom" FIXED 32768 PAD $FF

# Set Endianness
ENDIAN LITTLE

# Place the code segment at the beginning
WRITE SEGMENT "CODE"

# Write a signature at a specific address
SEGMENT Signature AT $7FF0
    WRITE STRING "MYGAME"
    WRITE WORD $1234

# Check if we overflowed
IF IMAGE_END > 32768
    ERROR "ROM size exceeded!"
END
```
