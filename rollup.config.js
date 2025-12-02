// rollup.config.js

import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import { defineConfig } from "rollup";

export default defineConfig([
	{
		output: {
			dir: "dist",
			format: "esm",
			sourcemap: true,
		},
		plugins: [typescript(), json(), terser()],
	},
]);
