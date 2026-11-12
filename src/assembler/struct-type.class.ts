/**
 * A field of a struct: its offset and its size. A number is a `.byte`, `.word` or `.long` field, which takes a number;
 * bytes a `.res <count>` one, which takes a string or an array of bytes.
 */
export type StructField = { readonly name: string; readonly offset: number; readonly size: number; readonly kind: "number" | "bytes" };

/**
 * A `.struct`: its fields' offsets, read as an object's fields (`Sprite.tile`), and its size (`.size(Sprite)`).
 * The fields are its only own properties, as written: `.has`, `.json`, `.log` and the symbol file see them as an object's.
 */
export class StructType {
	readonly #name: string;
	readonly #size: number;
	readonly #fields: ReadonlyMap<string, StructField>;

	constructor(name: string, fields: ReadonlyArray<StructField>, size: number) {
		this.#name = name;
		this.#size = size;
		this.#fields = new Map(fields.map((field) => [field.name, field]));
		// A field named `__proto__` is a field too, not the object's prototype.
		for (const { name, offset } of fields) Object.defineProperty(this, name, { value: offset, enumerable: true });
	}

	/** Its name, as written after `.struct`. */
	static nameOf(struct: StructType): string {
		return struct.#name;
	}

	/** How many bytes it takes: its fields' sizes added up. */
	static sizeOf(struct: StructType): number {
		return struct.#size;
	}

	/** The offset of `field`, as written: an error naming the struct's fields if it has none of that name. */
	static offsetOf(struct: StructType, field: string): number {
		return StructType.fieldOf(struct, field).offset;
	}

	/** The field named `field`, as written: an error naming the struct's fields if it has none of that name. */
	static fieldOf(struct: StructType, field: string): StructField {
		const found = struct.#fields.get(field);
		if (found) return found;
		const fields = [...struct.#fields.keys()];
		const list = fields.length ? `its fields are ${fields.join(", ")}` : "it has no field";
		throw new Error(`'${field}' is not a field of struct ${struct.#name}: ${list}.`);
	}
}
