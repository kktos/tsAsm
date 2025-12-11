import { writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { chdir } from "node:process";
import { name, version } from "../../package.json";
import { Assembler } from "../assembler/polyasm";
import type { AssemblerOptions } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { DirectiveContext } from "../directives/directive.interface";
import { Logger } from "../helpers/logger.class";
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

fileHandler.basedir = `${dirname(confFilename)}/${dirname(conf.input.source)}/`;

const segments = conf.input.segments;

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
	const options: AssemblerOptions = { logger, rawDataProcessors: handlers };
	if (segments) options.segments = segments;
	const assembler = new Assembler(new Cpu6502Handler(), fileHandler, options);
	const sourceFile = fileHandler.readSourceFile(basename(conf.input.source));

	const segmentList = assembler.assemble(sourceFile);

	chdir(dirname(confFilename));

	if (conf.output?.segments?.enabled) {
		const segmentsFilename = conf.output.segments.path ?? `${basename(conf.input.source)}.seg`;
		const map: Record<string, unknown> = {};
		for (const segment of segmentList) {
			const s: Record<string, unknown> = { size: segment.size, start: segment.start };
			if (segment.padValue) s.padValue = segment.padValue;
			if (segment.resizable) s.resizable = segment.resizable;
			map[segment.name] = s;
		}
		writeFileSync(segmentsFilename, yamlstringify(map, { flowLevel: 1, sortKeys: false }));
	}

	if (conf.output?.linker?.script) {
		fileHandler.basedir = `${dirname(confFilename)}/`;
		const scriptFile = fileHandler.readSourceFile(conf.output?.linker?.script);
		const result = assembler.linker.link(scriptFile, assembler.parser, assembler);

		const buffer = Buffer.from(result.bytes);
		writeFileSync(result.outputFile.filename, buffer);
	} else if (conf.output?.object?.path) {
		const objFile = assembler.link();
		const buffer = Buffer.from(objFile);
		writeFileSync(conf.output.object.path, buffer);
	}

	if (conf.output?.symbols?.enabled) {
		const symbolsFilename = conf.output.symbols.path ?? `${basename(conf.input.source)}.sym`;
		const index = assembler.symbolTable.getDict();
		writeFileSync(symbolsFilename, yamlstringify(index));
	}
} catch (e) {
	logger.error(colors.red(`${e}`));
}
