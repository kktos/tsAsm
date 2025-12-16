import { writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { chdir } from "node:process";
import { name, version } from "../../package.json";
import { Assembler } from "../assembler/polyasm";
import type { AssemblerOptions } from "../assembler/polyasm.types";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import type { DirectiveContext } from "../directives/directive.interface";
import { Logger } from "../helpers/logger.class";
import { parseCliArgs } from "./args";
import { yamlparse, yamlstringify } from "./asm-yaml";
import colors from "./colors";
import { readConf } from "./conf";
import { NodeFileHandler } from "./file";
import { FileSink } from "./filesink.class";
import type { ValidationError } from "./schema";

console.log(colors.cyan(`${name} v${version}`));

const printErrorsAndExit = (errors: ValidationError[]) => {
	console.error("");
	console.error(colors.red("Invalid configuration file"));
	for (const error of errors) console.error(colors.red(`${error.path}: ${error.message}`));
	process.exit(-1);
};

const cliArgs = parseCliArgs(process.argv.slice(2), name);

const confFilename = cliArgs.projectName as string;
const fileHandler = new NodeFileHandler();

const { conf, errors } = readConf(fileHandler, confFilename);
if (errors) printErrorsAndExit(errors);

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

const logger = new Logger({
	sink: new FileSink(conf.output?.listing?.path ?? `${basename(conf.input.source)}.lst`),
	enabled: conf.output?.listing?.enabled ?? false,
	cached: false,
});

const options: AssemblerOptions = {
	logger,
	rawDataProcessors: handlers,
	log: {
		pass1Enabled: conf.output?.listing?.passes?.pass1 === true,
		pass2Enabled: conf.output?.listing?.passes?.pass2 === true,
	},
};
if (segments) options.segments = segments;

try {
	const assembler = new Assembler(new Cpu6502Handler(), fileHandler, options);
	const sourceFile = fileHandler.readSourceFile(basename(conf.input.source));

	const segmentList = assembler.assemble(sourceFile);

	if (!conf.output) process.exit(0);

	chdir(dirname(confFilename));

	if (conf.output.segments?.enabled === true) {
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

	if (cliArgs.link) {
		if (conf.output.linker?.script) {
			fileHandler.basedir = `${dirname(confFilename)}/`;
			const scriptFile = fileHandler.readSourceFile(conf.output?.linker?.script);
			const result = assembler.linker.link(scriptFile, conf.output.object?.path, assembler);

			const buffer = Buffer.from(result.data);
			writeFileSync(result.name, buffer);
		} else if (conf.output.object?.path) {
			const objFile = assembler.link(); // This creates the object file, not final linking
			const buffer = Buffer.from(objFile);
			writeFileSync(conf.output.object.path, buffer);
		}
	}

	if (conf.output.symbols?.enabled === true) {
		const symbolsFilename = conf.output.symbols.path ?? `${basename(conf.input.source)}.sym`;
		const index = assembler.symbolTable.getDict();
		writeFileSync(symbolsFilename, yamlstringify(index));
	}
} catch (e) {
	logger.error(colors.red(`${e}`));
}
