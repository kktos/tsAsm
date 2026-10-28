import { Mos65xxHandler, type Mos65xxProfile } from "./mos65xx.class";
import { CMOS_ADDITIONS, NMOS, ROCKWELL_BITOPS, WDC_ADDITIONS } from "./mos65xx.opcodes";

/** The WDC W65C02S: the CMOS 65C02, with Rockwell's bit instructions and WDC's STP / WAI. */
export const P65C02: Mos65xxProfile = {
	cpuType: "65C02",
	opcodeSets: [NMOS, CMOS_ADDITIONS, ROCKWELL_BITOPS, WDC_ADDITIONS],
	suffixes: { B: 1, W: 2 },
};

export class Cpu65C02Handler extends Mos65xxHandler {
	constructor() {
		super(P65C02);
	}
}
