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
