// rollup.config.js

import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import { defineConfig } from "rollup";

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
};

const target = process.env.TARGET;

if (target && !Object.keys(configs).includes(target)) {
	throw new Error(`Unknown target: ${target}`);
}

// @ts-expect-error - target is a string
const selectedConfigs = target ? [configs[target]] : Object.values(configs);

export default defineConfig(selectedConfigs);
