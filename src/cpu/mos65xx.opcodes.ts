/** The 65xx addressing modes. A CPU's profile lists the opcode sets it's made of, and each set gives the modes it has. */
export type Mos65xxMode =
	| "IMPLIED" // rts
	| "ACCUMULATOR" // asl a, or asl
	| "IMMEDIATE" // lda #$12
	| "RELATIVE" // bne label
	| "ZEROPAGE_RELATIVE" // bbr0 $12,label
	| "ZEROPAGE" // lda $12
	| "ZEROPAGE_X" // lda $12,x
	| "ZEROPAGE_Y" // ldx $12,y
	| "ABSOLUTE" // lda $1234
	| "ABSOLUTE_X" // lda $1234,x
	| "ABSOLUTE_Y" // lda $1234,y
	| "INDIRECT_X" // lda ($12,x)
	| "INDIRECT_Y" // lda ($12),y
	| "ZEROPAGE_INDIRECT" // lda ($12)
	| "INDIRECT" // jmp ($1234)
	| "ABSOLUTE_INDIRECT_X"; // jmp ($1234,x)

/** Mnemonic → mode → opcode. Read-only: a handler copies the sets it merges, so building one CPU can't change another. */
export type OpcodeSet = Readonly<Record<string, Readonly<Partial<Record<Mos65xxMode, number>>>>>;

/** The NMOS 6502's documented instructions. */
export const NMOS: OpcodeSet = {
	ADC: { IMMEDIATE: 0x69, ZEROPAGE: 0x65, ZEROPAGE_X: 0x75, ABSOLUTE: 0x6d, ABSOLUTE_X: 0x7d, ABSOLUTE_Y: 0x79, INDIRECT_X: 0x61, INDIRECT_Y: 0x71 },
	AND: { IMMEDIATE: 0x29, ZEROPAGE: 0x25, ZEROPAGE_X: 0x35, ABSOLUTE: 0x2d, ABSOLUTE_X: 0x3d, ABSOLUTE_Y: 0x39, INDIRECT_X: 0x21, INDIRECT_Y: 0x31 },
	ASL: { ACCUMULATOR: 0x0a, ZEROPAGE: 0x06, ZEROPAGE_X: 0x16, ABSOLUTE: 0x0e, ABSOLUTE_X: 0x1e },
	BCC: { RELATIVE: 0x90 },
	BCS: { RELATIVE: 0xb0 },
	BEQ: { RELATIVE: 0xf0 },
	BIT: { ZEROPAGE: 0x24, ABSOLUTE: 0x2c },
	BMI: { RELATIVE: 0x30 },
	BNE: { RELATIVE: 0xd0 },
	BPL: { RELATIVE: 0x10 },
	BRK: { IMPLIED: 0x00 },
	BVC: { RELATIVE: 0x50 },
	BVS: { RELATIVE: 0x70 },
	CLC: { IMPLIED: 0x18 },
	CLD: { IMPLIED: 0xd8 },
	CLI: { IMPLIED: 0x58 },
	CLV: { IMPLIED: 0xb8 },
	CMP: { IMMEDIATE: 0xc9, ZEROPAGE: 0xc5, ZEROPAGE_X: 0xd5, ABSOLUTE: 0xcd, ABSOLUTE_X: 0xdd, ABSOLUTE_Y: 0xd9, INDIRECT_X: 0xc1, INDIRECT_Y: 0xd1 },
	CPX: { IMMEDIATE: 0xe0, ZEROPAGE: 0xe4, ABSOLUTE: 0xec },
	CPY: { IMMEDIATE: 0xc0, ZEROPAGE: 0xc4, ABSOLUTE: 0xcc },
	DEC: { ZEROPAGE: 0xc6, ZEROPAGE_X: 0xd6, ABSOLUTE: 0xce, ABSOLUTE_X: 0xde },
	DEX: { IMPLIED: 0xca },
	DEY: { IMPLIED: 0x88 },
	EOR: { IMMEDIATE: 0x49, ZEROPAGE: 0x45, ZEROPAGE_X: 0x55, ABSOLUTE: 0x4d, ABSOLUTE_X: 0x5d, ABSOLUTE_Y: 0x59, INDIRECT_X: 0x41, INDIRECT_Y: 0x51 },
	INC: { ZEROPAGE: 0xe6, ZEROPAGE_X: 0xf6, ABSOLUTE: 0xee, ABSOLUTE_X: 0xfe },
	INX: { IMPLIED: 0xe8 },
	INY: { IMPLIED: 0xc8 },
	JMP: { ABSOLUTE: 0x4c, INDIRECT: 0x6c },
	JSR: { ABSOLUTE: 0x20 },
	LDA: { IMMEDIATE: 0xa9, ZEROPAGE: 0xa5, ZEROPAGE_X: 0xb5, ABSOLUTE: 0xad, ABSOLUTE_X: 0xbd, ABSOLUTE_Y: 0xb9, INDIRECT_X: 0xa1, INDIRECT_Y: 0xb1 },
	LDX: { IMMEDIATE: 0xa2, ZEROPAGE: 0xa6, ZEROPAGE_Y: 0xb6, ABSOLUTE: 0xae, ABSOLUTE_Y: 0xbe },
	LDY: { IMMEDIATE: 0xa0, ZEROPAGE: 0xa4, ZEROPAGE_X: 0xb4, ABSOLUTE: 0xac, ABSOLUTE_X: 0xbc },
	LSR: { ACCUMULATOR: 0x4a, ZEROPAGE: 0x46, ZEROPAGE_X: 0x56, ABSOLUTE: 0x4e, ABSOLUTE_X: 0x5e },
	NOP: { IMPLIED: 0xea },
	ORA: { IMMEDIATE: 0x09, ZEROPAGE: 0x05, ZEROPAGE_X: 0x15, ABSOLUTE: 0x0d, ABSOLUTE_X: 0x1d, ABSOLUTE_Y: 0x19, INDIRECT_X: 0x01, INDIRECT_Y: 0x11 },
	PHA: { IMPLIED: 0x48 },
	PHP: { IMPLIED: 0x08 },
	PLA: { IMPLIED: 0x68 },
	PLP: { IMPLIED: 0x28 },
	ROL: { ACCUMULATOR: 0x2a, ZEROPAGE: 0x26, ZEROPAGE_X: 0x36, ABSOLUTE: 0x2e, ABSOLUTE_X: 0x3e },
	ROR: { ACCUMULATOR: 0x6a, ZEROPAGE: 0x66, ZEROPAGE_X: 0x76, ABSOLUTE: 0x6e, ABSOLUTE_X: 0x7e },
	RTI: { IMPLIED: 0x40 },
	RTS: { IMPLIED: 0x60 },
	SBC: { IMMEDIATE: 0xe9, ZEROPAGE: 0xe5, ZEROPAGE_X: 0xf5, ABSOLUTE: 0xed, ABSOLUTE_X: 0xfd, ABSOLUTE_Y: 0xf9, INDIRECT_X: 0xe1, INDIRECT_Y: 0xf1 },
	SEC: { IMPLIED: 0x38 },
	SED: { IMPLIED: 0xf8 },
	SEI: { IMPLIED: 0x78 },
	STA: { ZEROPAGE: 0x85, ZEROPAGE_X: 0x95, ABSOLUTE: 0x8d, ABSOLUTE_X: 0x9d, ABSOLUTE_Y: 0x99, INDIRECT_X: 0x81, INDIRECT_Y: 0x91 },
	STX: { ZEROPAGE: 0x86, ZEROPAGE_Y: 0x96, ABSOLUTE: 0x8e },
	STY: { ZEROPAGE: 0x84, ZEROPAGE_X: 0x94, ABSOLUTE: 0x8c },
	TAX: { IMPLIED: 0xaa },
	TAY: { IMPLIED: 0xa8 },
	TSX: { IMPLIED: 0xba },
	TXA: { IMPLIED: 0x8a },
	TXS: { IMPLIED: 0x9a },
	TYA: { IMPLIED: 0x98 },
};

/** What the CMOS 65C02 adds to NMOS: new instructions, and new modes for NMOS ones. */
export const CMOS_ADDITIONS: OpcodeSet = {
	ADC: { ZEROPAGE_INDIRECT: 0x72 },
	AND: { ZEROPAGE_INDIRECT: 0x32 },
	BIT: { IMMEDIATE: 0x89, ZEROPAGE_X: 0x34, ABSOLUTE_X: 0x3c },
	BRA: { RELATIVE: 0x80 },
	CMP: { ZEROPAGE_INDIRECT: 0xd2 },
	DEC: { ACCUMULATOR: 0x3a },
	EOR: { ZEROPAGE_INDIRECT: 0x52 },
	INC: { ACCUMULATOR: 0x1a },
	JMP: { ABSOLUTE_INDIRECT_X: 0x7c },
	LDA: { ZEROPAGE_INDIRECT: 0xb2 },
	ORA: { ZEROPAGE_INDIRECT: 0x12 },
	PHX: { IMPLIED: 0xda },
	PHY: { IMPLIED: 0x5a },
	PLX: { IMPLIED: 0xfa },
	PLY: { IMPLIED: 0x7a },
	SBC: { ZEROPAGE_INDIRECT: 0xf2 },
	STA: { ZEROPAGE_INDIRECT: 0x92 },
	STZ: { ZEROPAGE: 0x64, ZEROPAGE_X: 0x74, ABSOLUTE: 0x9c, ABSOLUTE_X: 0x9e },
	TRB: { ZEROPAGE: 0x14, ABSOLUTE: 0x1c },
	TSB: { ZEROPAGE: 0x04, ABSOLUTE: 0x0c },
};

/** Rockwell's bit instructions, in the WDC 65C02 too: the bit number is in the mnemonic and in the opcode's high nibble. */
export const ROCKWELL_BITOPS: OpcodeSet = Object.fromEntries(
	[0, 1, 2, 3, 4, 5, 6, 7].flatMap((bit) => [
		[`RMB${bit}`, { ZEROPAGE: 0x07 + bit * 0x10 }],
		[`SMB${bit}`, { ZEROPAGE: 0x87 + bit * 0x10 }],
		[`BBR${bit}`, { ZEROPAGE_RELATIVE: 0x0f + bit * 0x10 }],
		[`BBS${bit}`, { ZEROPAGE_RELATIVE: 0x8f + bit * 0x10 }],
	]),
);

/** What WDC adds, in its 65C02 and the 65816: STP stops the clock, WAI waits for an interrupt. */
export const WDC_ADDITIONS: OpcodeSet = {
	STP: { IMPLIED: 0xdb },
	WAI: { IMPLIED: 0xcb },
};
