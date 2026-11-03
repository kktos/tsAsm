// rollup.config.js

import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import { defineConfig } from "rollup";

/**
 * The extension's grammar: grammar.ts is bundled, run, and only the JSON it builds is written. The mnemonics come
 * from the CPUs, so the grammar is built from the code rather than kept by hand.
 */
function vscodeGrammar() {
	return {
		name: "vscode-grammar",
		async generateBundle(_options, bundle) {
			const [fileName, chunk] = Object.entries(bundle).find(([, file]) => file.type === "chunk");
			const { buildGrammar } = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`);
			delete bundle[fileName];
			this.emitFile({ type: "asset", fileName: "tsasm.tmLanguage.json", source: `${JSON.stringify(buildGrammar(), null, "\t")}\n` });
		},
	};
}

// The extension's code, in the extension's dist: the library's declarations aren't written there.
const vscodeTypescript = () => typescript({ noEmitOnError: true, declaration: false, declarationMap: false, sourceMap: false, outDir: "editors/vscode/dist" });

const configs = {
	cli: {
		// Configuration for the 'tsasm' CLI executable
		input: "src/cli/main.ts",
		output: {
			file: "dist/tsasm",
			banner: "#!/usr/bin/env node",
			format: "esm",
			sourcemap: false,
		},
		plugins: [
			// bundle dependencies (js-yaml) so the CLI is a single file needing only node
			nodeResolve({ preferBuiltins: true }),
			// abort on type errors instead of warning and emitting anyway
			typescript({ noEmitOnError: true }),
			json(),
			terser({
				compress: true,
				mangle: true,
			}),
		],
	},
	lib: {
		// Configuration for the 'libtsasm' library
		input: "src/assembler/polyasm.ts",
		output: {
			file: "dist/libtsasm.js",
			format: "esm",
			sourcemap: true,
		},
		plugins: [
			typescript({ noEmitOnError: true }),
			json(),
			terser({
				compress: true,
				mangle: true,
			}),
		],
	},
	vscode: [
		{
			// The VS Code extension (editors/vscode): VS Code loads it as CommonJS, and gives it the vscode module
			input: "src/vscode/extension.ts",
			output: { file: "editors/vscode/dist/extension.js", format: "cjs", sourcemap: false },
			external: ["vscode"],
			plugins: [vscodeTypescript()],
		},
		{
			input: "src/vscode/grammar.ts",
			output: { dir: "editors/vscode/dist", format: "esm" },
			plugins: [vscodeTypescript(), json(), vscodeGrammar()],
		},
	],
};

const target = process.env.TARGET;

if (target && !Object.keys(configs).includes(target)) {
	throw new Error(`Unknown target: ${target}`);
}

// @ts-expect-error - target is a string
const selectedConfigs = (target ? [configs[target]] : Object.values(configs)).flat();

export default defineConfig(selectedConfigs);
