export function hasNoMoreThanOne<T>(arr: T[], predicate: (value: T, index: number, array: T[]) => boolean) {
	let count = 0;
	for (let i = 0; i < arr.length; i++) {
		if (predicate(arr[i] as T, i, arr)) {
			count++;
			if (count > 1) return false; // Early exit!
		}
	}
	return count <= 1;
}

const converters: [Record<8 | 16 | 32, (list: number[], value: number) => void>, Record<8 | 16 | 32, (list: number[], value: number) => void>] = [
	{
		8: (list: number[], value: number) => list.push(value),
		16: (list: number[], value: number) => list.push(value & 0xff, value >>> 8),
		32: (list: number[], value: number) => list.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24),
	},
	{
		8: (list: number[], value: number) => list.push(value),
		16: (list: number[], value: number) => list.push(value >>> 8, value & 0xff),
		32: (list: number[], value: number) => list.push(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff),
	},
];
const maxValues = { 8: 0xff, 16: 0xffff, 32: 0xffffffff };
export function pushNumber(list: number[], value: number, bitSize: 8 | 16 | 32, isLittleEndian: boolean) {
	if (value >>> 0 !== value || value > maxValues[bitSize]) throw new RangeError(`Value ${value} out of range for ${bitSize}-bit (0-${maxValues[bitSize]})`);
	const converter = converters[isLittleEndian ? 0 : 1][bitSize];
	converter(list, value);
}

const ranges = {
	8: { min: -128, max: 127 },
	16: { min: -32768, max: 32767 },
	32: { min: -2147483648, max: 2147483647 },
};
export function pushSignedNumber(list: number[], value: number, bitSize: 8 | 16 | 32, isLittleEndian: boolean) {
	const { min, max } = ranges[bitSize];
	if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`Value ${value} out of range for signed ${bitSize}-bit (${min} to ${max})`);
	const unsignedValue = value < 0 ? (1 << bitSize) + value : value;
	const converter = converters[isLittleEndian ? 0 : 1][bitSize];
	converter(list, unsignedValue);
}
