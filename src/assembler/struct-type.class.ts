/**
 * A `.struct`: its fields' offsets, read as an object's fields (`Sprite.tile`), and its size (`.size(Sprite)`).
 * The fields are its only own properties, as written: `.has`, `.json`, `.log` and the symbol file see them as an object's.
 */
export class StructType {
	readonly #name: string;
	readonly #size: number;

	constructor(name: string, fields: ReadonlyArray<readonly [string, number]>, size: number) {
		this.#name = name;
		this.#size = size;
		// A field named `__proto__` is a field too, not the object's prototype.
		for (const [field, offset] of fields) Object.defineProperty(this, field, { value: offset, enumerable: true });
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
		if (Object.hasOwn(struct, field)) return (struct as unknown as Record<string, number>)[field] as number;
		const fields = Object.keys(struct);
		const list = fields.length ? `its fields are ${fields.join(", ")}` : "it has no field";
		throw new Error(`'${field}' is not a field of struct ${struct.#name}: ${list}.`);
	}
}
