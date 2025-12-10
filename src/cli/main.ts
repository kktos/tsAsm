import * as console from "node:console";
import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chdir } from "node:process";
import { name, version } from "../../package.json";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { DirectiveContext } from "../directives/directive.interface";
import { Logger } from "../logger.class";
import { Assembler } from "../polyasm";
import { yamlparse, yamlstringify } from "./asm-yaml";
import colors from "./colors";
import { readConf } from "./conf";
import { NodeFileHandler } from "./file";

const logger = new Logger();

logger.log(colors.cyan(`${name} v${version}`));

const args = process.argv.slice(2);
// logger.log(colors.yellow(`Arguments received: ${args.join(", ") || "None"}`));
if (args.length < 1 || !args[0]) {
	logger.error(colors.red("ERROR: Missing source file argument or configuration file argument"));
	process.exit(-1);
}

const confFilename = args[0];
const fileHandler = new NodeFileHandler();

const { conf, errors } = readConf(fileHandler, confFilename);
if (errors) {
	logger.error("");
	logger.error(colors.red("Invalid configuration file"));
	for (const error of errors) logger.error(colors.red(`${error.path}: ${error.message}`));

	process.exit(-1);
}

chdir(dirname(confFilename));

const segments = conf.segments;

const textHandler = (blockContent: string, _context: DirectiveContext) => blockContent;
const yamlHandler = (blockContent: string, _context: DirectiveContext) => yamlparse(blockContent);
const jsonHandler = (blockContent: string, _context: DirectiveContext) => JSON.parse(blockContent);
const handlers = {
	default: "YAML",
	map: new Map([
		["TEXT", textHandler],
		["YAML", yamlHandler],
		["JSON", jsonHandler],
	]),
};

try {
	const assembler = new Assembler(new Cpu6502Handler(), fileHandler, { logger, segments, rawDataProcessors: handlers });
	const sourceFile = fileHandler.readSourceFile(conf.src as string);

	chdir(dirname(conf.src as string));

	const _segmentList = assembler.assemble(sourceFile);

	// for (const segment of segmentList) {
	// 	logger.log(segment.name);
	// 	logger.log(hexDump(segment.start, segment.data));
	// }

	const objFile = assembler.link();

	const buffer = Buffer.from(objFile);
	writeFileSync(conf.out as string, buffer);

	const index = assembler.symbolTable.getDict();
	console.log(yamlstringify(index));
} catch (e) {
	logger.error(colors.red(`${e}`));
}
