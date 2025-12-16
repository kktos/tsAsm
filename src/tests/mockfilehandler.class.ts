import type { FileHandler } from "../assembler/polyasm.types";

export class MockFileHandler implements FileHandler {
	fullpath = "";
	filename = "";
	readSourceFile(filename: string): string {
		throw new Error(`Mock file not found: "${filename}"`);
	}

	readBinaryFile(filename: string): number[] {
		throw new Error(`Mock bin file not found: ${filename}`);
	}
}
