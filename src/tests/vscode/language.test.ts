import { describe, expect, it } from "vitest";
import { analyse } from "../../vscode/analysis";
import { language } from "../../vscode/language";

const LANGUAGE = language();

describe("VS Code language", () => {
	it("lists each CPU's mnemonics and own directives, and the general directives", () => {
		const cpu6502 = LANGUAGE.cpus.find(({ name }) => name === "6502");
		expect(cpu6502?.mnemonics).toContain("LDA");
		expect(LANGUAGE.directives).toEqual(expect.arrayContaining(["MACRO", "PROC", "END", "ELSE", "ELSEIF", "DB", "OPTION"]));
		const own = LANGUAGE.cpus.flatMap(({ directives }) => directives);
		for (const name of own) expect(LANGUAGE.directives).not.toContain(name);
	});

	it("names each system function's parameters, as many as it takes", () => {
		for (const { name, parameters, minArgs, maxArgs, description } of LANGUAGE.functions) {
			expect(parameters.length, name).toBeGreaterThanOrEqual(minArgs);
			expect(parameters.length, name).toBeLessThanOrEqual(maxArgs);
			if (maxArgs === Number.POSITIVE_INFINITY) expect(parameters.length, name).toBeGreaterThan(0);
			expect(description, name).not.toBe("");
		}
	});

	it("lists the system variables the assembler resolves", () => {
		const main = LANGUAGE.variables.map(({ name }) => `v${name} = .${name.toLowerCase()}`).join("\n");
		const texts: Record<string, string> = { "/p/proj.yaml": "input:\n  source: main.asm\n", "/p/main.asm": `${main}\n` };
		const analysis = analyse("/p/proj.yaml", { readText: (path) => texts[path] as string, readBytes: () => [] });
		expect(analysis.diagnostics).toEqual([]);
		expect(LANGUAGE.variables.map(({ name }) => name)).toEqual(expect.arrayContaining(["PC", "PASS", "SEGMENT"]));
	});

	it("lists the .option names, with their values", () => {
		expect(LANGUAGE.options.find(({ name }) => name === "listing.case")?.values).toContain("upper");
	});
});
