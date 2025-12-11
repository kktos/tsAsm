export function stringToASCIICharCodes(str: string) {
	const len = str.length;
	const result = new Uint8Array(len);
	for (let i = 0; i < len; i++) result[i] = str.charCodeAt(i);
	return result;
}
