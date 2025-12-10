import type { FileHandler } from "../polyasm.types";
import { yamlparse } from "./asm-yaml";
import { type InferObject, validate } from "./schema";

// export type TConf = {
// 	segments?: SegmentDefinition[];
// 	symbols?: Record<string, unknown>;
// 	src: string;
// 	out: string;
// 	options: {
// 		segments: boolean;
// 		symbols: boolean;
// 		listing: boolean;
// 	};
// 	link: {
// 		post: string;
// 	};
// };

const confSchema = {
	src: { type: "string" },
	out: { type: "string" },
	// link: { type: "string" },
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

	// age: {
	// 	type: "number",
	// 	validate: (n: unknown) => Number(n) >= 0 && Number(n) <= 150,
	// 	errorMessage: "Age must be between 0 and 150",
	// },
	// tags: {
	// 	type: "array",
	// 	items: { type: "string" },
	// },
	// address: {
	// 	type: "object",
	// 	optional: true,
	// 	schema: {
	// 		city: { type: "string" },
	// 		zip: { type: "string" },
	// 	},
	// },
} as const;

type TConf = InferObject<typeof confSchema>;

export function readConf(fileHandler: FileHandler, filename: string) {
	const confFile = fileHandler.readSourceFile(filename);
	const conf = yamlparse(confFile) as Record<string, unknown>;
	const result = validate(conf, confSchema);
	return { conf: conf as TConf, errors: result.ok ? undefined : result.errors };
}
