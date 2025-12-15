// rollup.config.js

import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import { defineConfig } from "rollup";

export default defineConfig([
	{
		// Configuration for the 'tsasm' CLI executable
		input: "src/cli/main.ts",
		output: {
			file: "dist/tsasm",
			banner: "#!/usr/bin/env node",
			format: "esm",
			sourcemap: false,
		},
		plugins: [
			typescript(),
			json(),
			// For maximum obfuscation, enable property mangling.
			// WARNING: This is an advanced option that can break your code.
			terser({
				compress: true,
				mangle: true,
			}),
		],
	},
	{
		// Configuration for the 'libtsasm' library
		input: "src/assembler/polyasm.ts",
		output: {
			file: "dist/libtsasm.js",
			format: "esm",
			sourcemap: true,
		},
		plugins: [
			typescript(),
			json(),
			// For maximum obfuscation, enable property mangling.
			// WARNING: This is an advanced option that can break your code.
			terser({
				compress: true,
				mangle: true,
			}),
		],
	},
]);
