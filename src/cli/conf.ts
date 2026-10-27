import { YAMLException } from "js-yaml";
import { isLabelChar, isListingCase, isLoopStart, LABEL_CHARS_TEXT, LISTING_CASES_TEXT, LOOP_STARTS_TEXT } from "../assembler/options";
import type { FileHandler } from "../assembler/polyasm.types";
import handlers from "../cpu";
import { AsmError } from "../utils/error.utils";
import { yamlparse } from "./asm-yaml";
import { type InferObject, validate } from "./schema";

const availableCpus = Object.keys(handlers);

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

const loopStart = {
	type: "number",
	optional: true,
	validate: isLoopStart,
	errorMessage: `Must be one of ${LOOP_STARTS_TEXT}`,
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
					schema: {
						name: { type: "string" },
						start: { type: "number" },
						size: { type: "number" },
						padValue: { type: "number", optional: true },
						resizable: { type: "boolean", optional: true },
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
					"repeat.start": loopStart,
					"for.start": loopStart,
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
					enabled: { type: "boolean", optional: true },
					passes: {
						type: "object",
						optional: true,
						schema: {
							pass1: { type: "boolean", optional: true },
							pass2: { type: "boolean", optional: true },
						},
					},
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

type TConf = InferObject<typeof confSchema>;

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
	return { conf: conf as TConf, errors: result.ok ? undefined : result.errors };
}
