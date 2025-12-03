import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chdir } from "node:process";
import { name, version } from "../../package.json";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../logger";
import { Assembler } from "../polyasm";
import type { FileHandler, SegmentDefinition } from "../polyasm.types";
import { yamlparse } from "./asm-yaml";

class NodeFileHandler implements FileHandler {
	readSourceFile(filename: string): string {
		return readFileSync(filename, "utf-8");
	}
	readBinaryFile(filename: string): number[] {
		const buffer = readFileSync(filename);
		return Array.from(buffer);
	}
}

// A simple color utility using ANSI escape codes
const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
};

const logger = new Logger();

logger.log(`${colors.cyan}${name} v${version}${colors.reset}`);

// To get the arguments passed to your CLI, you can use `process.argv`.
// The first two elements are the node executable and the script path,
// so we slice the array to get only the user-provided arguments.
const args = process.argv.slice(2);
logger.log(`Arguments received: ${colors.yellow}${args.join(", ") || "None"}${colors.reset}`);

if (args.length < 1 || !args[0]) {
	logger.error(`${colors.red}ERROR: Missing source file argument or configuration file argument${colors.reset}`);
	process.exit(-1);
}

const confFilename = args[0];
const fileHandler = new NodeFileHandler();
const confFile = fileHandler.readSourceFile(confFilename);
const conf = yamlparse(confFile) as Record<string, unknown>;
console.log(conf);
chdir(dirname(confFilename));

const segments = (conf.segments as SegmentDefinition[]) ?? undefined;

const assembler = new Assembler(new Cpu6502Handler(), fileHandler, { logger, segments });
const sourceFile = fileHandler.readSourceFile(conf.src as string);
const segmentList = assembler.assemble(sourceFile);

for (const segment of segmentList) {
	logger.log(segment.name);
	// logger.log(hexDump(segment.start, segment.data));
}

const objFile = assembler.link();

const buffer = Buffer.from(objFile);
writeFileSync(conf.out as string, buffer);
