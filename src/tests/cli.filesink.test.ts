import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSink } from "../cli/sinks/filesink.class";

describe("CLI FileSink", () => {
	let dir: string;
	let consoleError: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "tsasm-filesink-"));
		consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleError.mockRestore();
		process.exitCode = undefined;
		rmSync(dir, { recursive: true, force: true });
	});

	it("creates the missing directories of the listing", async () => {
		const sink = new FileSink(join(dir, "out", "lst"), "main.lst");
		sink.log("line 1");

		await vi.waitFor(() => expect(readFileSync(join(dir, "out", "lst", "main.lst"), "utf8")).toBe("line 1\n"));
		expect(consoleError).not.toHaveBeenCalled();
	});

	it("reports a listing that can't be created instead of crashing", () => {
		writeFileSync(join(dir, "afile"), "");
		const sink = new FileSink(join(dir, "afile"), "main.lst");
		sink.log("line 1");

		expect(consoleError).toHaveBeenCalledOnce();
		expect(consoleError.mock.calls[0]?.[0]).toContain("unable to write the listing");
		expect(process.exitCode).toBe(1);
	});

	it("reports a listing that can't be opened instead of crashing", async () => {
		// the listing path is an existing directory: the open fails asynchronously
		const sink = new FileSink(dir, "");
		sink.log("line 1");
		sink.log("line 2");

		await vi.waitFor(() => expect(consoleError).toHaveBeenCalledOnce());
		expect(consoleError.mock.calls[0]?.[0]).toContain("unable to write the listing");
		expect(process.exitCode).toBe(1);
	});
});
