import { Mos65xxHandler, type Mos65xxProfile } from "./mos65xx.class";
import { NMOS } from "./mos65xx.opcodes";

export const P6502: Mos65xxProfile = {
	cpuType: "6502",
	addressBits: 16,
	opcodeSets: [NMOS],
	suffixes: { B: 1, W: 2 },
};

export class Cpu6502Handler extends Mos65xxHandler {
	constructor() {
		super(P6502);
	}
}
