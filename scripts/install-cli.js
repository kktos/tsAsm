#!/usr/bin/env node
// Installs dist/tsasm as a `tsasm` shell command (macOS/Linux and Windows).
//
// usage: node scripts/install-cli.js [--uninstall] [--dir <bin directory>]
//
// The command is a link back to this checkout rather than a copy, so a
// rebuild is picked up without reinstalling.
// - macOS/Linux: a symlink <bin>/tsasm -> dist/tsasm
// - Windows:     a <bin>/tsasm.cmd shim running `node dist/tsasm`
// <bin> defaults to npm's global bin directory, which is normally on the PATH.

import { execSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const CMD_NAME = "tsasm";
const SHIM_MARKER = "rem tsasm-cli-shim";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(projectDir, "dist", "tsasm");

function fail(msg) {
	console.error(`error: ${msg}`);
	process.exit(1);
}

function parseArgs(argv) {
	const args = { uninstall: false, dir: undefined };
	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--uninstall":
				args.uninstall = true;
				break;
			case "--dir":
				args.dir = argv[++i];
				if (!args.dir) fail("--dir needs a directory");
				break;
			default:
				fail(`unknown option ${argv[i]}\nusage: node scripts/install-cli.js [--uninstall] [--dir <bin directory>]`);
		}
	}
	return args;
}

function npmGlobalBinDir() {
	let prefix;
	try {
		prefix = execSync("npm prefix -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		fail("unable to find npm's global bin directory; pass one with --dir <bin directory>");
	}
	// npm puts global commands in <prefix> on Windows and <prefix>/bin elsewhere
	return isWindows ? prefix : join(prefix, "bin");
}

function isOnPath(dir) {
	const normalize = (p) => (isWindows ? resolve(p).toLowerCase() : resolve(p));
	const target = normalize(dir);
	return (process.env.PATH ?? "")
		.split(delimiter)
		.filter(Boolean)
		.some((p) => normalize(p) === target);
}

// Only touch what a previous install created, never an unrelated tsasm command.
function isOurs(target) {
	const stat = lstatSync(target, { throwIfNoEntry: false });
	if (!stat) return false;
	if (isWindows) return stat.isFile() && readFileSync(target, "utf8").includes(SHIM_MARKER);
	return stat.isSymbolicLink() && resolve(dirname(target), readlinkSync(target)) === cliPath;
}

function install(binDir) {
	if (!existsSync(cliPath)) fail(`${cliPath} not found; run "pnpm build:cli" first`);
	if (!existsSync(binDir)) fail(`${binDir} does not exist`);

	const target = join(binDir, isWindows ? `${CMD_NAME}.cmd` : CMD_NAME);
	if (lstatSync(target, { throwIfNoEntry: false })) {
		if (!isOurs(target)) fail(`${target} already exists and was not installed by this script; remove it first`);
		unlinkSync(target);
	}

	try {
		if (isWindows) {
			writeFileSync(target, `@echo off\r\n${SHIM_MARKER}\r\nnode "${cliPath}" %*\r\n`);
		} else {
			chmodSync(cliPath, 0o755);
			symlinkSync(cliPath, target);
		}
	} catch (e) {
		if (e.code === "EACCES" || e.code === "EPERM") fail(`no permission to write in ${binDir}; pick another directory with --dir <bin directory>`);
		throw e;
	}

	console.log(`installed ${target} -> ${cliPath}`);
	if (!isOnPath(binDir)) console.warn(`warning: ${binDir} is not in your PATH; add it to be able to run "${CMD_NAME}"`);
}

function uninstall(binDir) {
	const target = join(binDir, isWindows ? `${CMD_NAME}.cmd` : CMD_NAME);
	if (!lstatSync(target, { throwIfNoEntry: false })) {
		console.log(`nothing to uninstall: ${target} does not exist`);
		return;
	}
	if (!isOurs(target)) fail(`${target} was not installed by this script; leaving it alone`);
	unlinkSync(target);
	console.log(`removed ${target}`);
}

const args = parseArgs(process.argv.slice(2));
const binDir = resolve(args.dir ?? npmGlobalBinDir());
if (args.uninstall) uninstall(binDir);
else install(binDir);
