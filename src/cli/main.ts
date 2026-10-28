import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { name, version } from "../../package.json";
import { Assembler } from "../assembler/polyasm";
import type { AssemblerOptions } from "../assembler/polyasm.types";
import handlers from "../cpu";
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

// Every path in the project file is relative to the project file
const projectDir = resolve(dirname(confFilename));
const projectPath = (path: string) => resolve(projectDir, path);

// Output paths may name directories that don't exist yet
const writeOutputFile = (path: string, data: string | Buffer) => {
	const fullpath = projectPath(path);
	mkdirSync(dirname(fullpath), { recursive: true });
	writeFileSync(fullpath, data);
};

fileHandler.basedir = `${projectPath(dirname(conf.input.source))}/`;

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

const listing = conf.output?.listing;
const listingEnabled = listing?.enabled ?? false;
const listingPath = projectPath(listing?.path ?? `${conf.input.source}.lst`);
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
// The command line's .option values override the project file's
options.options = { ...conf.input.options, ...cliArgs.options };

try {
	// Every CPU the CLI has: .cpu can switch to any of them. The project file picks the one the source starts with.
	const cpus = Object.values(handlers).map((CpuHandlerClass) => new CpuHandlerClass());
	options.cpu = conf.input.cpu || "6502";

	const assembler = new Assembler(cpus, fileHandler, options);
	const sourceFile = fileHandler.readSourceFile(basename(conf.input.source));

	const segmentList = assembler.assemble(sourceFile);

	if (!conf.output) process.exit(0);

	if (conf.output.segments?.enabled === true) {
		const segmentsFilename = conf.output.segments.path ?? `${basename(conf.input.source)}.seg`;
		const map: Record<string, unknown> = {};
		for (const segment of segmentList) {
			const s: Record<string, unknown> = segment.relocatable ? { size: segment.size, relocatable: true } : { size: segment.size, start: segment.start };
			if (segment.padValue) s.padValue = segment.padValue;
			if (segment.resizable) s.resizable = segment.resizable;
			map[segment.name] = s;
		}
		writeOutputFile(segmentsFilename, yamlstringify(map, { flowLevel: 1, sortKeys: false }));
	}

	if (cliArgs.link) {
		if (conf.output.linker?.script) {
			fileHandler.basedir = `${projectDir}/`;
			const scriptFile = fileHandler.readSourceFile(conf.output?.linker?.script);
			// The linker's report and the script's .LOG go to the listing, like the assembler's; warnings and errors to the console.
			const linkerLogger = new Logger({
				sink,
				enabled: listingEnabled && listing?.linker === true,
				cached: false,
			});
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
