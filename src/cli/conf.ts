import { YAMLException } from "js-yaml";
import {
	FUNCTION_RECURSION_TEXT,
	isFunctionRecursion,
	isLabelChar,
	isListingCase,
	isListingData,
	isLoopStart,
	LABEL_CHARS_TEXT,
	LISTING_CASES_TEXT,
	LISTING_DATA_TEXT,
	LOOP_STARTS_TEXT,
} from "../assembler/options";
import type { FileHandler } from "../assembler/polyasm.types";
import handlers from "../cpu";
import { isMaxSize, MAX_SIZE_TEXT } from "../linker/linker.class";
import { AsmError } from "../utils/error.utils";
import { yamlparse } from "./asm-yaml";
import { type InferObject, type ValidationError, validate } from "./schema";

// A CPU's aliases are names of it too: `65C816` for the 65816.
const availableCpus = Object.entries(handlers).flatMap(([name, Handler]) => [name, ...(new Handler().aliases ?? [])]);

const labelChar = {
	type: "string",
	optional: true,
	validate: isLabelChar,
	errorMessage: `Must be one of ${LABEL_CHARS_TEXT}`,
} as const;

const listingCase = {
	type: "string",
	optional: true,
	validate: isListingCase,
	errorMessage: `Must be one of ${LISTING_CASES_TEXT}`,
} as const;

const listingData = {
	type: "string",
	optional: true,
	validate: isListingData,
	errorMessage: `Must be one of ${LISTING_DATA_TEXT}`,
} as const;

const loopStart = {
	type: "number",
	optional: true,
	validate: isLoopStart,
	errorMessage: `Must be one of ${LOOP_STARTS_TEXT}`,
} as const;

const functionRecursion = {
	type: "number",
	optional: true,
	validate: isFunctionRecursion,
	errorMessage: `Must be a whole number from ${FUNCTION_RECURSION_TEXT}`,
} as const;

const confSchema = {
	input: {
		type: "object",
		schema: {
			cpu: {
				type: "string",
				optional: true,
				validate: (v: unknown) => availableCpus.includes((v as string).toUpperCase()),
				errorMessage: `Invalid cpu. Available cpus are: ${availableCpus.join(", ")}`,
			},
			source: { type: "string" },
			segments: {
				type: "array",
				optional: true,
				items: {
					type: "object",
					// Any other key is an attribute, a number or a string: checked by the assembler
					allowUnknown: true,
					schema: {
						name: { type: "string" },
						// Required unless relocatable: checked by the assembler
						start: { type: "number", optional: true },
						size: { type: "number", optional: true },
						pad: { type: "number", optional: true },
						resizable: { type: "boolean", optional: true },
						relocatable: { type: "boolean", optional: true },
						reloc: { type: "boolean", optional: true },
						banksize: { type: "number", optional: true },
					},
				},
			},
			// The `.option` values the source starts with
			options: {
				type: "object",
				optional: true,
				schema: {
					"local.prefix": labelChar,
					"anon.marker": labelChar,
					"listing.case": listingCase,
					"listing.data": listingData,
					"repeat.start": loopStart,
					"for.start": loopStart,
					"function.recursion": functionRecursion,
				},
			},
			// Constants the source starts with: names and values are checked by the assembler
			symbols: { type: "object", optional: true, allowUnknown: true, schema: {} },
			linker: {
				type: "object",
				optional: true,
				schema: {
					maxSize: {
						type: "number",
						optional: true,
						validate: isMaxSize,
						errorMessage: `Must be a whole number from ${MAX_SIZE_TEXT}`,
					},
				},
			},
		},
	},
	output: {
		type: "object",
		optional: true,
		schema: {
			linker: {
				type: "object",
				optional: true,
				schema: {
					script: { type: "string" },
				},
			},
			object: {
				type: "object",
				optional: true,
				schema: {
					path: { type: "string" },
				},
			},
			listing: {
				type: "object",
				optional: true,
				schema: {
					path: { type: "string", optional: true },
					// What the listing lists: the file is written when one of them is on.
					pass1: { type: "boolean", optional: true },
					pass2: { type: "boolean", optional: true },
					linker: { type: "boolean", optional: true },
				},
			},
			symbols: {
				type: "object",
				optional: true,
				schema: {
					path: { type: "string", optional: true },
					enabled: { type: "boolean", optional: true },
				},
			},
			segments: {
				type: "object",
				optional: true,
				schema: {
					path: { type: "string", optional: true },
					enabled: { type: "boolean", optional: true },
				},
			},
		},
	},
} as const;

/** A project file, as `readConf` reads it. */
export type ProjectConf = InferObject<typeof confSchema>;

/** A project file that can't be read, isn't YAML or isn't a mapping throws an AsmError; one that doesn't fit the schema returns `errors`. */
export function readConf(fileHandler: FileHandler, filename: string) {
	let confFile: string;
	try {
		confFile = fileHandler.readSourceFile(filename);
	} catch (e) {
		const err = e as NodeJS.ErrnoException;
		throw new AsmError(err.code === "ENOENT" ? "Project file not found." : `Unable to read the project file: ${err.message}`, { file: filename });
	}

	let conf: Record<string, unknown>;
	try {
		conf = yamlparse(confFile) as Record<string, unknown>;
	} catch (e) {
		if (!(e instanceof YAMLException)) throw e;
		if (!e.mark) throw new AsmError(e.reason, { file: filename });
		const error = new AsmError(e.reason, { file: filename, line: e.mark.line + 1, column: e.mark.column + 1 });
		error.sourceLine = confFile.split(/\r?\n/)[e.mark.line];
		throw error;
	}
	// an empty file, a list or a scalar
	if (typeof conf !== "object" || conf === null || Array.isArray(conf))
		throw new AsmError("The project file must be a YAML mapping, with an `input` key.", { file: filename });

	// YAML reads `cpu: 6502` as a number
	const input = conf.input as Record<string, unknown> | undefined;
	if (typeof input?.cpu === "number") input.cpu = String(input.cpu);
	const result = validate(conf, confSchema);
	if (!result.ok) return { conf: conf as ProjectConf, errors: result.errors, warnings: undefined };
	const warnings = confWarnings(conf as ProjectConf);
	return { conf: conf as ProjectConf, errors: undefined, warnings: warnings.length > 0 ? warnings : undefined };
}

/** What the project file says that does nothing, by its setting's path, as the schema's errors. */
function confWarnings(conf: ProjectConf): ValidationError[] {
	const warnings: ValidationError[] = [];
	if (conf.output?.listing && !listsAnything(conf.output.listing))
		warnings.push({ path: "output.listing", message: "Lists nothing, so no listing is written: set pass1, pass2 or linker to true." });
	return warnings;
}

/** Whether the listing lists anything: the CLI writes it only then. */
export const listsAnything = (listing: NonNullable<ProjectConf["output"]>["listing"] | null | undefined) =>
	listing?.pass1 === true || listing?.pass2 === true || listing?.linker === true;
