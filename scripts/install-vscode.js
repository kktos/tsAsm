#!/usr/bin/env node
// Builds the VS Code extension (editors/vscode) under a new version and installs it in VS Code.
//
// usage: node scripts/install-vscode.js [patch|minor|major|--no-bump] [--code <command>]
//
// - bumps the version in editors/vscode/package.json (patch by default), so VS Code sees a new extension;
// - builds it (pnpm build:vscode), packages it with vsce into a .vsix in the system's temp directory;
// - installs the .vsix with `code --install-extension` (`--code code-insiders`, `--code cursor` for another editor).
// The open windows keep the old version until they're reloaded (Developer: Reload Window).

import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "usage: node scripts/install-vscode.js [patch|minor|major|--no-bump] [--code <command>]";
const isWindows = process.platform === "win32";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(projectDir, "editors", "vscode");
const manifestPath = join(extensionDir, "package.json");

function fail(msg) {
	console.error(`error: ${msg}`);
	process.exit(1);
}

function parseArgs(argv) {
	const args = { bump: "patch", code: "code" };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "patch" || arg === "minor" || arg === "major") args.bump = arg;
		else if (arg === "--no-bump") args.bump = undefined;
		else if (arg === "--code") {
			args.code = argv[++i];
			if (!args.code) fail("--code needs a command");
		} else fail(`unknown option ${arg}\n${USAGE}`);
	}
	return args;
}

/** Runs a command, its output shown: a failure stops the script. */
function run(command, args, cwd = projectDir) {
	console.log(`> ${command} ${args.join(" ")}`);
	try {
		// On Windows, pnpm and code are .cmd scripts, which only a shell runs.
		execFileSync(command, args, { cwd, stdio: "inherit", shell: isWindows });
	} catch (e) {
		if (e.code === "ENOENT") fail(`"${command}" not found: is it on your PATH?`);
		fail(`"${command} ${args.join(" ")}" failed`);
	}
}

/** The next version: `0.1.0` → `0.1.1` for a patch. */
function nextVersion(version, bump) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) fail(`editors/vscode/package.json's version "${version}" isn't major.minor.patch`);
	const [major, minor, patch] = match.slice(1).map(Number);
	if (bump === "major") return `${major + 1}.0.0`;
	if (bump === "minor") return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
}

/** Writes the new version, only its line changed, the file's layout kept. */
function bumpVersion(bump) {
	const text = readFileSync(manifestPath, "utf8");
	const manifest = JSON.parse(text);
	if (!bump) return manifest;
	const version = nextVersion(manifest.version, bump);
	writeFileSync(manifestPath, text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`));
	console.log(`editors/vscode: ${manifest.version} -> ${version}`);
	return { ...manifest, version };
}

/** A link in VS Code's extensions to this checkout (README: "While working on it"): it would load instead of the .vsix. */
function warnLinkedCopy(manifest) {
	const extensions = join(homedir(), ".vscode", "extensions");
	let entries = [];
	try {
		entries = readdirSync(extensions);
	} catch {
		return;
	}
	const prefix = `${manifest.publisher}.${manifest.name}`.toLowerCase();
	for (const entry of entries) {
		if (!entry.toLowerCase().startsWith(prefix)) continue;
		const path = join(extensions, entry);
		if (lstatSync(path).isSymbolicLink())
			console.warn(`warning: ${path} is a link to a checkout, which VS Code may load instead: remove the link to use the installed version`);
	}
}

const args = parseArgs(process.argv.slice(2));
const manifest = bumpVersion(args.bump);
run("pnpm", ["build:vscode"]);

const vsix = join(mkdtempSync(join(tmpdir(), "tsasm-vscode-")), `${manifest.name}-${manifest.version}.vsix`);
run("pnpm", ["dlx", "@vscode/vsce", "package", "--skip-license", "--no-dependencies", "--out", vsix], extensionDir);
run(args.code, ["--install-extension", vsix, "--force"]);

warnLinkedCopy(manifest);
console.log(`installed ${manifest.publisher}.${manifest.name} ${manifest.version}: reload the VS Code windows (Developer: Reload Window) to use it`);
