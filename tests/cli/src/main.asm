Start

	.segment main { start: 0x1000, size: 0x0100, pad: 0xFF }
	.segment main

	name = "test"

	FillMemory:
		LDX #$00
	:loop
		STA $2000,X
		INX
		BNE :loop
		RTS

	.namespace main

	list = [ 1, 2, 3 ]

	FillMemory:
		LDX #$00
	:loop
		STA $2000,X
		INX
		BNE :loop
		RTS

	.text name
