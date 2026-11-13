import { describe, expect, it } from "vitest";
import { EditorConfigError, editorConfigFor, formatSettings, globPattern } from "../../format/editorconfig";

/** The properties of `file`, its `.editorconfig` files in `files`, by path. */
const propertiesOf = (file: string, files: Record<string, string>) =>
	Object.fromEntries([...editorConfigFor(file, (path) => files[path])].map(([name, { value }]) => [name, value]));

/** The formatter's settings `config`, the only `.editorconfig`, gives `file`. */
const settingsOf = (config: string, file = "/repo/src/main.asm") =>
	formatSettings(editorConfigFor(file, (path) => (path === "/repo/.editorconfig" ? config : undefined)));

describe("VS Code .editorconfig", () => {
	it("reads the sections matching a file, a later one overriding an earlier one", () => {
		const config = `
root = true
# a comment
[*]
indent_style = tab
tab_width = 4

[*.asm]
tsasm_opcode_column = 12
; another comment
[*.md]
tab_width = 2
`;
		expect(propertiesOf("/repo/src/main.asm", { "/repo/.editorconfig": config })).toEqual({
			indent_style: "tab",
			tab_width: "4",
			tsasm_opcode_column: "12",
		});
		expect(propertiesOf("/repo/README.md", { "/repo/.editorconfig": config })).toEqual({ indent_style: "tab", tab_width: "2" });
	});

	it("reads the files from the file's folder up to a root one, the closest overriding, unset removing", () => {
		const files = {
			"/.editorconfig": "[*]\ntsasm_indent_blocks = false\n",
			"/repo/.editorconfig": "root = true\n[*]\nindent_style = tab\ntsasm_comment_column = 40\n",
			"/repo/src/.editorconfig": "[*.asm]\ntsasm_comment_column = 32\nindent_style = unset\n",
		};
		expect(propertiesOf("/repo/src/main.asm", files)).toEqual({ tsasm_comment_column: "32" });
		expect(propertiesOf("/repo/lib/x.asm", files)).toEqual({ indent_style: "tab", tsasm_comment_column: "40" });
	});

	it("matches the globs as EditorConfig does", () => {
		const matches = (glob: string, path: string) => globPattern(glob).test(path);
		expect([matches("*.asm", "a.asm"), matches("*.asm", "src/a.asm"), matches("*.asm", "a.asmx")]).toEqual([true, true, false]);
		expect([matches("src/*.asm", "src/a.asm"), matches("src/*.asm", "src/x/a.asm"), matches("/src/**.asm", "src/x/a.asm")]).toEqual([true, false, true]);
		expect([matches("*.{asm,s}", "a.s"), matches("*.{asm,s}", "a.inc"), matches("{a}.asm", "{a}.asm")]).toEqual([true, false, true]);
		expect([matches("file{1..3}.asm", "file2.asm"), matches("file{1..3}.asm", "file4.asm")]).toEqual([true, false]);
		expect([matches("[ab].asm", "b.asm"), matches("[!ab].asm", "b.asm"), matches("?.asm", "c.asm"), matches("a\\*.asm", "a*.asm")]).toEqual([
			true,
			false,
			true,
			true,
		]);
	});

	it("gives the formatter's settings: tabs or spaces, their width, the tsasm_ keys", () => {
		expect(
			settingsOf(`
[*.asm]
indent_style = space
indent_size = 2
tab_width = 8
tsasm_opcode_column = 10
tsasm_operand_column = 20
tsasm_comment_column = 0
tsasm_indent_blocks = FALSE
`),
		).toEqual({ insertSpaces: true, tabSize: 2, opcodeColumn: 10, operandColumn: 20, commentColumn: 0, indentBlocks: false });
		expect(settingsOf("[*]\nindent_style = tab\nindent_size = 3\n")).toEqual({ insertSpaces: false, tabSize: 3 });
		expect(settingsOf("[*]\nindent_style = tab\nindent_size = tab\ntab_width = 5\n")).toEqual({ insertSpaces: false, tabSize: 5 });
		// EditorConfig's own keys with a value it doesn't know are ignored, as it says.
		expect(settingsOf("[*]\nindent_style = tabs\ntab_width = wide\nend_of_line = lf\n")).toEqual({});
	});

	it("is an error for a tsasm_ key it doesn't know or a bad value, where it is", () => {
		const error = (config: string) => {
			try {
				settingsOf(config);
			} catch (e) {
				if (e instanceof EditorConfigError) return `${e.file}:${e.line} ${e.message}`;
				throw e;
			}
			return undefined;
		};
		expect(error("[*.asm]\n\ntsasm_opcode_column = abc\n")).toBe("/repo/.editorconfig:3 tsasm_opcode_column = abc: a column is a whole number, from 0.");
		expect(error("[*.asm]\ntsasm_comment_column = -1\n")).toBe("/repo/.editorconfig:2 tsasm_comment_column = -1: a column is a whole number, from 0.");
		expect(error("[*.asm]\ntsasm_indent_blocks = yes\n")).toBe("/repo/.editorconfig:2 tsasm_indent_blocks = yes: it's true or false.");
		expect(error("[*.asm]\ntsasm_opcod_column = 8\n")).toBe(
			"/repo/.editorconfig:2 Unknown key tsasm_opcod_column: the tsAsm keys are tsasm_opcode_column, tsasm_operand_column, tsasm_comment_column, tsasm_indent_blocks.",
		);
		// Only the sections matching the file count.
		expect(error("[*.md]\ntsasm_opcode_column = abc\n")).toBeUndefined();
	});
});
