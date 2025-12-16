import { Cpu65C02Handler } from "./cpu65c02.class";
import { Cpu6502Handler } from "./cpu6502.class";
import { Cpu6809Handler } from "./cpu6809.class";
import { CpuArmRiscHandler } from "./cpuarm.class";
import type { CPUHandler } from "./cpuhandler.class";

const handlers: Record<string, new () => CPUHandler> = {
	"6502": Cpu6502Handler,
	"65C02": Cpu65C02Handler,
	"6809": Cpu6809Handler,
	ARM_RISC: CpuArmRiscHandler,
};

export default handlers;
