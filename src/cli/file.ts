import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FileHandler } from "../assembler/polyasm.types";

export class NodeFileHandler implements FileHandler {
	public fullpath = "";
	public basedir = "";

	readSourceFile(filename: string, from?: string): string {
		this.fullpath = filename;
		if (from) {
			const dir = dirname(from);
			this.fullpath = `${dir}/${filename}`;
		}
		return readFileSync(`${this.basedir}${this.fullpath}`, "utf-8");
	}
	readBinaryFile(filename: string, from?: string): number[] {
		this.fullpath = filename;
		if (from) {
			const dir = dirname(from);
			this.fullpath = `${dir}/${filename}`;
		}
		const buffer = readFileSync(`${this.basedir}/${this.fullpath}`);
		return Array.from(buffer);
	}
}
