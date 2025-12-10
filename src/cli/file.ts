import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FileHandler } from "../polyasm.types";

export class NodeFileHandler implements FileHandler {
	fullpath = "";
	readSourceFile(filename: string, from?: string): string {
		this.fullpath = filename;
		if (from) {
			const dir = dirname(from);
			this.fullpath = `${dir}/${filename}`;
		}
		// logger.log(colors.blue(`READFILE ${this.fullpath} FROM ${from}`));
		return readFileSync(this.fullpath, "utf-8");
	}
	readBinaryFile(filename: string, from?: string): number[] {
		this.fullpath = filename;
		if (from) {
			const dir = dirname(from);
			this.fullpath = `${dir}/${filename}`;
		}
		const buffer = readFileSync(this.fullpath);
		return Array.from(buffer);
	}
}
