import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import type { SegmentDefinition } from "../assembler/polyasm.types";
import { Cpu65C02Handler } from "../cpu/cpu65c02.class";
import { MockFileHandler } from "./mockfilehandler.class";

const DEFAULT_SEGMENTS = [{ name: "CODE", start: 0x1000, size: 0, resizable: true }];

describe("String Directives", () => {
	const createAssembler = (segments: SegmentDefinition[] = DEFAULT_SEGMENTS) => {
		const mockFileHandler = new MockFileHandler();
		return new Assembler(new Cpu65C02Handler(), mockFileHandler, { segments });
	};

	it("should handle .TEXT directive with single and multiple strings", () => {
		const assembler = createAssembler();
		const source = `
            .TEXT "HELLO", " WORLD"
        `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		const expected = "HELLO WORLD".split("").map((c) => c.charCodeAt(0));
		expect(machineCode).toEqual(expected);
	});

	it("should handle .CSTR directive and its aliases (.CSTRING, .ASCIIZ)", () => {
		const assembler = createAssembler();
		const source = `
			.CSTRING "C2"
            .CSTR "C1"
            .ASCIIZ "C3"
        `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([
			0x43,
			0x32,
			0x00, // "C2" + null
			0x43,
			0x31,
			0x00, // "C1" + null
			0x43,
			0x33,
			0x00, // "C3" + null
		]);
	});

	it("should handle .PSTR directive for Pascal-style strings", () => {
		const assembler = createAssembler();
		const source = `
            .PSTR "Pascal", ""
        `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([
			0x06,
			0x50,
			0x61,
			0x73,
			0x63,
			0x61,
			0x6c, // len("Pascal") + "Pascal"
			0x00, // len("")
		]);
	});

	it("should handle .PSTRL directive for long Pascal-style strings", () => {
		const assembler = createAssembler();
		const source = `
            .PSTRL "Long Pascal"
        `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([
			0x0b,
			0x00,
			0x4c,
			0x6f,
			0x6e,
			0x67,
			0x20,
			0x50,
			0x61,
			0x73,
			0x63,
			0x61,
			0x6c, // 11 (little-endian) + "Long Pascal"
		]);
	});

	it("should throw an error if a non-string expression is provided", () => {
		const assembler = createAssembler();
		const source = `
            .TEXT 12345
        `;
		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: ".TEXT expression must evaluate to a string.",
				location: expect.objectContaining({ line: 2 }),
			}),
		);
	});

	it("should throw an error for .PSTR string exceeding 255 bytes", () => {
		const assembler = createAssembler();
		const longString = "A".repeat(256);
		const source = `
            .PSTR "${longString}"
        `;
		expect(() => assembler.assemble(source)).toThrow(
			expect.objectContaining({
				message: ".PSTR string length cannot exceed 255 bytes.",
				location: expect.objectContaining({ line: 2 }),
			}),
		);
	});

	it("should correctly calculate size in Pass 1", () => {
		const segments: SegmentDefinition[] = [{ name: "CODE", start: 0, size: 0x10000 }];
		const assembler = createAssembler(segments);
		const source = `
			Start:
				.TEXT "ABC"      ; 3 bytes
				.CSTR "DEF"      ; 4 bytes
				.PSTR "GHI"      ; 4 bytes
				.PSTRL "JKL"     ; 5 bytes
			End: .DB 0
		`;
		assembler.assemble(source);
		const startAddress = assembler.symbolTable.lookupSymbol("Start");
		expect(startAddress).toBe(0);
		const endAddress = assembler.symbolTable.lookupSymbol("End");
		expect(endAddress).toBe(3 + 4 + 4 + 5);
	});

	it("should handle escape sequences correctly", () => {
		const assembler = createAssembler();
		const source = `
            .TEXT "Line 1\\nLine 2\\tTabbed\\rReturn'\\"Quote\\x21\\\\"
        `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		const expectedString = "Line 1\nLine 2\tTabbed\rReturn'\"Quote!\\";
		const expected = expectedString.split("").map((c) => c.charCodeAt(0));
		expect(machineCode).toEqual(expected);
	});

	it("should handle symbols as string", () => {
		const assembler = createAssembler();
		const source = `
			mystring = "hello"
            .TEXT mystring
        `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		const expectedString = "hello";
		const expected = expectedString.split("").map((c) => c.charCodeAt(0));
		expect(machineCode).toEqual(expected);
	});

	it("should handle multiple expressions", () => {
		const assembler = createAssembler();
		const source = `
            .TEXT "{", .hex(16,4), "}"
        `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		const expectedString = "{$0010}";
		const expected = expectedString.split("").map((c) => c.charCodeAt(0));
		expect(machineCode).toEqual(expected);
	});

	it("should handle assembing and not assembling", () => {
		const assembler = createAssembler();
		const source = `
				.org $1000
				lda #<test
				lda #>test
				.IF 0
					.TEXT "{", .hex(16,4), "}"
				.END
			test:
        `;
		assembler.assemble(source);
		const machineCode = assembler.link();
		expect(machineCode).toEqual([0xa9, 0x04, 0xa9, 0x10]);
	});

	it.each([
		['.text msg\nmsg = "hi"', ".TEXT: 'MSG'"],
		['.cstr "a", msg\nmsg = "hi"', ".CSTR: 'MSG'"],
		['.pstr msg\nmsg = "hi"', ".PSTR: 'MSG'"],
		['.macro m s\n.text s\n.end\n m msg\nmsg = "hi"', ".TEXT: 'MSG'"],
	])("should throw when the string uses a symbol defined later: %j", (source, message) => {
		expect(() => createAssembler().assemble(source)).toThrow(
			`${message} must be defined before it is used here (its length is needed to place what follows).`,
		);
	});

	it.each([
		{
			source: `
				.text "a" + msg
				msg = "hi"
			`,
			message: ".TEXT: 'MSG'",
		},
		{
			source: `
				.cstr msg + "a"
				msg = "hi"
			`,
			message: ".CSTR: 'MSG'",
		},
		{
			source: `
				.pstr "a" + msg + "b"
				msg = "hi"
			`,
			message: ".PSTR: 'MSG'",
		},
		{
			source: `
				.text .str(n)
				n = 5
			`,
			message: ".TEXT: 'N'",
		},
		{
			source: `
				.cstr .type(n)
				n = 5
			`,
			message: ".CSTR: 'N'",
		},
		{
			source: `
				.pstr names[1]
				names = ["a", "bc"]
			`,
			message: ".PSTR: 'NAMES'",
		},
		{
			source: `
				.text ["a", "bc"][i]
				i = 1
			`,
			message: ".TEXT: 'I'",
		},
	])("should throw when a string is computed from a symbol defined later: $message", ({ source, message }) => {
		expect(() => createAssembler().assemble(source)).toThrow(
			`${message} must be defined before it is used here (its length is needed to place what follows).`,
		);
	});

	it("should concatenate a string with a symbol defined before", () => {
		const assembler = createAssembler();
		const source = `
			msg = "b"
			.text "a" + msg
		`;
		assembler.assemble(source);
		expect(assembler.link()).toEqual([0x61, 0x62]);
	});

	it("should throw when the value isn't a string", () => {
		expect(() => createAssembler().assemble(".text 65")).toThrow(".TEXT expression must evaluate to a string.");
	});

	it.each([
		['.text "€"', ".TEXT: '€' (U+20AC)"],
		['.cstr "é€"', ".CSTR: '€' (U+20AC)"],
		['.pstr "😀"', ".PSTR: '😀' (U+1F600)"],
	])("should throw on a character above 255: %j", (source, message) => {
		expect(() => createAssembler().assemble(source)).toThrow(`${message} doesn't fit in a byte.`);
	});

	it("should write each element of a spread array as a string", () => {
		const assembler = createAssembler();
		const source = `
			names = ["a", "bc"]
			.CSTR ...names, "d"
			.PSTR ...["e"]
		`;
		assembler.assemble(source);
		expect(assembler.link()).toEqual([0x61, 0, 0x62, 0x63, 0, 0x64, 0, 1, 0x65]);
	});

	it("should throw on a spread array defined after the directive", () => {
		const source = `
			.TEXT ...names
			names = ["a"]
		`;
		expect(() => createAssembler().assemble(source)).toThrow(
			".TEXT: 'NAMES' must be defined before it is used here (its length is needed to place what follows).",
		);
	});

	it("should write characters up to 255 as bytes", () => {
		const assembler = createAssembler();
		assembler.assemble('.pstr "café"');
		expect(assembler.link()).toEqual([4, 0x63, 0x61, 0x66, 0xe9]);
	});
});
