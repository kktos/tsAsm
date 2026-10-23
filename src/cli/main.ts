import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { chdir } from "node:process";
import { name, version } from "../../package.json";
import { Assembler } from "../assembler/polyasm";
import type { AssemblerOptions } from "../assembler/polyasm.types";
import handlers from "../cpu";
import type { CPUHandler } from "../cpu/cpuhandler.interface";
import type { DirectiveContext } from "../directives/directive.interface";
import { Logger } from "../helpers/logger.class";
import { TeeSink } from "../helpers/teesink.class";
import { parseCliArgs } from "./args";
import { yamlparse, yamlstringify } from "./asm-yaml";
import colors from "./colors";
import { readConf } from "./conf";
import { NodeFileHandler } from "./file";
import type { ValidationError } from "./schema";
import { ConsoleErrorSink } from "./sinks/consoleerrorsink.class";
import { FileSink } from "./sinks/filesink.class";

console.log(colors.cyan(`${name} v${version}`));

const printErrorsAndExit = (errors: ValidationError[]) => {
	console.error("");
	console.error(colors.red("Invalid configuration file"));
	for (const error of errors) console.error(colors.red(`${error.path}: ${error.message}`));
	process.exit(-1);
};

// Output paths may name directories that don't exist yet
const writeOutputFile = (path: string, data: string | Buffer) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, data);
};

const cliArgs = parseCliArgs(process.argv.slice(2), name);

const confFilename = cliArgs.projectName as string;
const fileHandler = new NodeFileHandler();

let confResult: ReturnType<typeof readConf>;
try {
	confResult = readConf(fileHandler, confFilename);
} catch (e) {
	new ConsoleErrorSink().error(e);
	process.exit(-1);
}
const { conf, errors } = confResult;
if (errors) printErrorsAndExit(errors);

fileHandler.basedir = `${dirname(confFilename)}/${dirname(conf.input.source)}/`;

const segments = conf.input.segments;

const textHandler = (blockContent: string, _context: DirectiveContext) => blockContent;
const yamlHandler = (blockContent: string, _context: DirectiveContext) => yamlparse(blockContent);
const jsonHandler = (blockContent: string, _context: DirectiveContext) => JSON.parse(blockContent);
const dataProcessorhandlers = {
	default: "YAML",
	map: new Map([
		["TEXT", textHandler],
		["YAML", yamlHandler],
		["JSON", jsonHandler],
	]),
};

// Like the other outputs, the listing path is relative to the project file. It's made absolute
// as the file is only opened once the assembly is over, after the chdir below.
const listing = conf.output?.listing;
const listingEnabled = listing?.enabled ?? false;
const listingPath = resolve(dirname(confFilename), listing?.path ?? `${conf.input.source}.lst`);
const sink = listingEnabled ? new TeeSink(new FileSink(dirname(listingPath), basename(listingPath)), new ConsoleErrorSink()) : new ConsoleErrorSink();

const logger = new Logger({
	sink,
	enabled: listingEnabled,
	cached: false,
});

const options: AssemblerOptions = {
	logger,
	rawDataProcessors: dataProcessorhandlers,
	log: {
		pass1Enabled: conf.output?.listing?.passes?.pass1 === true,
		pass2Enabled: conf.output?.listing?.passes?.pass2 === true,
		linkerEnabled: listing?.linker === true,
	},
};
if (segments) options.segments = segments;

try {
	const cpuName = (conf.input.cpu || "6502").toUpperCase();
	const CpuHandlerClass = handlers[cpuName];
	if (!CpuHandlerClass) {
		console.error(colors.red(`Invalid CPU: ${cpuName}`));
		process.exit(-1);
	}
	const cpuHandler: CPUHandler = new CpuHandlerClass();

	const assembler = new Assembler(cpuHandler, fileHandler, options);
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
		writeOutputFile(segmentsFilename, yamlstringify(map, { flowLevel: 1, sortKeys: false }));
	}

	if (cliArgs.link) {
		if (conf.output.linker?.script) {
			fileHandler.basedir = `${dirname(confFilename)}/`;
			const scriptFile = fileHandler.readSourceFile(conf.output?.linker?.script);
			// The linker's report and the script's .LOG go to the listing, like the assembler's; warnings and errors to the console.
			const linkerLogger = new Logger({ sink, enabled: listingEnabled && listing?.linker === true, cached: false });
			const result = assembler.linker.link(scriptFile, conf.output.object?.path, linkerLogger);

			const buffer = Buffer.from(result.data);
			writeOutputFile(result.name, buffer);
		} else if (conf.output.object?.path) {
			const objFile = assembler.link(); // This creates the object file, not final linking
			const buffer = Buffer.from(objFile);
			writeOutputFile(conf.output.object.path, buffer);
		}
	}

	if (conf.output.symbols?.enabled === true) {
		const symbolsFilename = conf.output.symbols.path ?? `${basename(conf.input.source)}.sym`;
		const index = assembler.symbolTable.getDict();
		writeOutputFile(symbolsFilename, yamlstringify(index));
	}
} catch (e) {
	logger.error(e);
	process.exitCode = 1;
}
