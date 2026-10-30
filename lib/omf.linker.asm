# omf.linker.asm: an Apple IIgs OMF load file (S16), for a tsAsm linker script.
#
# Copy it next to the linker script, then:
#
#	.include "omf.linker.asm"
#	.OUTPUT "game.s16"
#	OMF_FILE "main"
#
# OMF_FILE writes every segment of the source, in their order, numbered from 1: an OMF version 2.0 segment
# each (GS/OS Reference, appendix F), its header, its bytes in one LCONST record, a RELOC record for each
# fixup to its own segment, an INTERSEG for each fixup to another one, and END. The program starts at the
# entry symbol, which must be in the first segment.
#
# A segment's attributes give its header's fields, defaulted when the source doesn't give them:
#
#	kind      KIND, $0000 (static code); $0001 is data          .segment DATA { reloc: true, kind: $0001 }
#	segname   SEGNAME, the segment's name
#	loadname  LOADNAME, up to 10 characters, spaces by default
#	banksize  BANKSIZE, $10000: the segment can't cross a bank; 0 for anywhere. A key the assembler checks, seg.banksize
#	align     ALIGN, 0

# The whole file: every segment, the program starting at the symbol `entryName`.
.macro OMF_FILE entryName
	.ENDIAN LITTLE

	entry = .symbol(entryName)
	first = .segments_list[0]
	.IF entry.segment != first.name
		.ERROR "The entry point '" + entryName + "' is in segment '" + entry.segment + "': it must be in the first one, '" + first.name + "', where GS/OS starts the program."
	.END

	.FOR seg OF .segments_list AS segnum FROM 1
		segEntry = 0
		.IF entry.segment == seg.name
			segEntry = entry.offset
		.END
		OMF_SEGMENT seg, segnum, segEntry
	.END
.END

# One segment, its number `segnum`, the program starting at `segEntry` in it.
.macro OMF_SEGMENT seg, segnum, segEntry
	.IF !seg.relocatable
		.ERROR "Segment '" + seg.name + "' has a start address: an OMF load file takes relocatable segments."
	.END

	kind = $0000
	.IF .has(seg.attrs, "kind")
		kind = seg.attrs.kind
	.END
	segname = seg.name
	.IF .has(seg.attrs, "segname")
		segname = seg.attrs.segname
	.END
	loadname = ""
	.IF .has(seg.attrs, "loadname")
		loadname = seg.attrs.loadname
	.END
	banksize = $10000
	.IF .has(seg, "banksize")
		banksize = seg.banksize
	.END
	align = 0
	.IF .has(seg.attrs, "align")
		align = seg.attrs.align
	.END

	length = seg.size
	.IF seg.resizable
		length = .len(seg.data)
	.END

	.IF .len(loadname) > 10
		.ERROR "Segment '" + seg.name + "': its loadname '" + loadname + "' is longer than 10 characters."
	.END
	.IF banksize > 0 && length > banksize
		.ERROR "Segment '" + seg.name + "' is " + .hex(length) + " bytes: it can't fit in its bank, " + .hex(banksize) + " bytes."
	.END

	header = .PC
	.LONG 0                             # BYTECNT: the segment's size in the file, written at its end
	.LONG 0                             # RESSPC
	.LONG length                        # LENGTH
	.BYTE 0, 0, 4, 2                    # undefined, LABLEN (SEGNAME is a Pascal string), NUMLEN, VERSION
	.LONG banksize                      # BANKSIZE
	.WORD kind                          # KIND
	.WORD 0                             # undefined
	.LONG 0                             # ORG
	.LONG align                         # ALIGN
	.BYTE 0, 0                          # NUMSEX (little-endian), undefined
	.WORD segnum                        # SEGNUM
	.LONG segEntry                      # ENTRY
	.WORD $2C                           # DISPNAME: LOADNAME, after this header
	.WORD $2C + 10 + 1 + .len(segname)  # DISPDATA: the first record, after SEGNAME
	.WRITE STRING .pad(loadname, -10)   # LOADNAME
	.pstring segname                    # SEGNAME

	.BYTE $F2                           # LCONST
	.LONG length
	.WRITE SEGMENT seg.name

	.FOR r OF seg.relocs
		.IF r.segment == seg.name
			.BYTE $E2, r.size, (0 - r.shift) & $FF   # RELOC: the shift is negative, to the right
			.LONG r.offset, r.targetOffset
		.ELSE
			.FOR target OF .segments_list AS targetnum FROM 1
				.IF target.name == r.segment
					.BYTE $E3, r.size, (0 - r.shift) & $FF   # INTERSEG
					.LONG r.offset
					.WORD 1, targetnum                        # this file, the target's segment
					.LONG r.targetOffset
				.END
			.END
		.END
	.END

	.BYTE $00                           # END
	.WRITE LONG .PC - header AT header
.END
