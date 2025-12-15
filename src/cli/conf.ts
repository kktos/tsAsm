import type { FileHandler } from "../assembler/polyasm.types";
import { yamlparse } from "./asm-yaml";
import { type InferObject, validate } from "./schema";

const confSchema = {
	input: {
		type: "object",
		schema: {
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

export function readConf(fileHandler: FileHandler, filename: string) {
	const confFile = fileHandler.readSourceFile(filename);
	const conf = yamlparse(confFile) as Record<string, unknown>;
	const result = validate(conf, confSchema);
	return { conf: conf as TConf, errors: result.ok ? undefined : result.errors };
}
