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
export function pushNumber(list: number[], value: number, endianSize: number) {
	const dataSize = Math.abs(endianSize);
	let numberValue = value;

	numberValue &= dataSize === 4 ? 0xffffffff : 0xffff;
	const byte3 = (numberValue >> 24) & 0xff;
	const byte2 = (numberValue >> 16) & 0xff;
	const byte1 = (numberValue >> 8) & 0xff;
	const byte0 = numberValue & 0xff;

	switch (endianSize) {
		// byte
		case 1:
			if (value > 0xff) throw "Data Overflow - 8bits expected";
			list.push(byte0);
			break;

		// word (2 bytes) little endian
		case 2:
			if (value > 0xffff) throw "Data Overflow - 16bits expected";
			list.push(byte0, byte1);
			break;

		// long (4 bytes) little endian
		case 4:
			list.push(byte0, byte1, byte2, byte3);
			break;

		// long (4 bytes) big endian
		case -4:
			list.push(byte3, byte2, byte1, byte0);
			break;

		// word (2 bytes) big endian
		case -2:
			list.push(byte1, byte0);
			break;
	}
}
