type PrimitiveType = "string" | "number" | "boolean" | "object" | "array";

type InferSchema<S extends SchemaSpec> = S["type"] extends "string"
	? string
	: S["type"] extends "number"
		? number
		: S["type"] extends "boolean"
			? boolean
			: S["type"] extends "object"
				? S["schema"] extends TSchema
					? InferObject<S["schema"]>
					: Record<string, unknown>
				: S["type"] extends "array"
					? S["items"] extends SchemaSpec
						? InferSchema<S["items"]>[]
						: unknown[]
					: never;

// Map a schema object → full inferred object
export type InferObject<S extends TSchema> = {
	[K in keyof S as S[K] extends { optional: true } ? never : K]: InferSchema<S[K]>;
} & {
	[K in keyof S as S[K] extends { optional: true } ? K : never]?: InferSchema<S[K]>;
};

interface SchemaSpec {
	type: PrimitiveType;
	optional?: boolean;

	schema?: TSchema;
	items?: SchemaSpec;

	validate?: (value: unknown) => boolean;
	errorMessage?: string;
}

export interface ValidationError {
	path: string; // "settings.darkMode"
	message: string; // "Expected boolean, got undefined"
}

interface ValidationResult {
	ok: boolean;
	errors: ValidationError[];
}

export type TSchema = Record<string, SchemaSpec>;

export function validate(obj: Record<string, unknown>, schema: TSchema): ValidationResult {
	const errors: ValidationError[] = [];
	validateInternal(obj, schema, "", errors);
	return { ok: errors.length === 0, errors };
}

function validateInternal(obj: Record<string, unknown>, schema: TSchema, basePath: string, errors: ValidationError[]) {
	for (const key in schema) {
		const spec = schema[key] as SchemaSpec;
		const value = obj[key];
		const path = basePath ? `${basePath}.${key}` : key;

		if (value === undefined) {
			if (!spec.optional)
				errors.push({
					path,
					message: "Missing required property",
				});
			continue;
		}

		// Type check
		switch (spec.type) {
			case "string":
				if (typeof value !== "string")
					errors.push({
						path,
						message: `Expected string, got ${typeof value}`,
					});
				break;

			case "number":
				if (typeof value !== "number" || Number.isNaN(value))
					errors.push({
						path,
						message: "Expected number",
					});
				break;

			case "boolean":
				if (typeof value !== "boolean")
					errors.push({
						path,
						message: "Expected boolean",
					});
				break;

			case "object":
				if (typeof value !== "object" || value === null || Array.isArray(value)) {
					errors.push({
						path,
						message: "Expected object",
					});
					break;
				}
				if (spec.schema) validateInternal(value as Record<string, unknown>, spec.schema, path, errors);
				break;

			case "array":
				if (!Array.isArray(value)) {
					errors.push({
						path,
						message: "Expected array",
					});
					break;
				}
				if (spec.items)
					for (let i = 0; i < value.length; i++) {
						const item = value[i];
						validateInternal({ _: item }, { _: spec.items }, `${path}[${i}]`, errors);
					}
				break;
		}

		// Custom constraint
		if (spec.validate && !spec.validate(value))
			errors.push({
				path,
				message: spec.errorMessage ?? "Custom validation failed",
			});
	}
}
/*
const userSchema = {
	name: { type: "string" },
	age: {
		type: "number",
		validate: (n: unknown) => Number(n) >= 0 && Number(n) <= 150,
		errorMessage: "Age must be between 0 and 150",
	},
	tags: {
		type: "array",
		items: { type: "string" },
	},
	address: {
		type: "object",
		optional: true,
		schema: {
			city: { type: "string" },
			zip: { type: "string" },
		},
	},
} as const;

type User = InferObject<typeof userSchema>;

const data: User = {
	name: "Jane",
	age: 200,
	tags: ["a", "5"],
};

console.log(validate(data, userSchema));
*/
