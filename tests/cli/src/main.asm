Start

	.segment main { start: 0x1000, size: 0x0100, pad: 0xFF }
	.segment main

	.echo "output test"

	.db $AA ^ $FF
	.db $81 & $F0
	.db $01 | $20
	.align $20, $FF
	.for addr of [1,2,3,0x45,$E0,$55,$10,0b1010_1010,%1000_0001] as idx
		.db idx
		.repeat 3 as idx2 {
			.db addr
		}
	.end

	.align $10, $FF

	.hex
		0E 60 0B 00 38 43 23 00 ; with comments !!
		60 6F 0B 00 40 7F 02 00
	.end
