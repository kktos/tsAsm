import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { FileHandler } from "../assembler/polyasm.types";

export class NodeFileHandler implements FileHandler {
	public fullpath = "";
	public filename = "";
	public basedir = "";

	readSourceFile(filename: string, from?: string): string {
		this.fullpath = filename;
		this.filename = basename(filename);
		// normalized: "modules/sprites/../../includes/x.asm" is "includes/x.asm"
		if (from) this.fullpath = join(dirname(from), filename);
		return readFileSync(`${this.basedir}${this.fullpath}`, "utf-8");
	}
	readBinaryFile(filename: string, from?: string): number[] {
		this.fullpath = filename;
		this.filename = basename(filename);
		if (from) this.fullpath = join(dirname(from), filename);
		const buffer = readFileSync(`${this.basedir}${this.fullpath}`);
		return Array.from(buffer);
	}
}
