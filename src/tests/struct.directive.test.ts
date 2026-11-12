import { describe, expect, it } from "vitest";
import { Assembler } from "../assembler/polyasm";
import { Cpu6502Handler } from "../cpu/cpu6502.class";
import { Logger } from "../helpers/logger.class";
import { MemorySink } from "../helpers/memorysink.class";
import { MockFileHandler } from "./mockfilehandler.class";

const SPRITE = `
.struct Sprite
    x     .byte
    y     .byte
    tile  .word
    name  .res 8
.end
`;

function newAssembler(sink = new MemorySink()) {
	return new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
		segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		logger: new Logger({ sink, enabled: false }),
	});
}

/** The bytes `source` assembles to, at $1000. */
function bytesOf(source: string): number[] {
	return newAssembler().assemble(source)[0]?.data ?? [];
}

/** What the logger got in pass 2: the listing, and what the `.log` lines write. */
function logsOf(source: string): string[] {
	const sink = new MemorySink();
	new Assembler(new Cpu6502Handler(), new MockFileHandler(), {
		segments: [{ name: "CODE", start: 0x1000, size: 0, resizable: true }],
		logger: new Logger({ sink, enabled: true }),
		log: { pass2Enabled: true },
	}).assemble(source);
	return sink.logs.map(String);
}

describe(".struct", () => {
	describe("a struct", () => {
		it("gives each field its offset, from the sizes of the fields before it, and its size", () => {
			const source = `
${SPRITE}
    .db Sprite.x, Sprite.y, Sprite.tile, Sprite.name, .size(Sprite)
`;
			expect(bytesOf(source)).toEqual([0, 1, 2, 4, 12]);
		});

		it("takes the data directives' aliases: .db, .dw, .dl, .long, .ds, .fill", () => {
			const source = `
.struct S
    a .db
    b .dw
    c .dl
    d .long
    e .ds 3
    f .fill 2
.end
    .db S.a, S.b, S.c, S.d, S.e, S.f, .size(S)
`;
			expect(bytesOf(source)).toEqual([0, 1, 3, 7, 11, 14, 16]);
		});

		it("takes a .res count from an expression known where the struct is", () => {
			const source = `
NAME_LEN = 6
.struct S
    name .res NAME_LEN + 2
    id   .byte
.end
    .db S.id, .size(S)
`;
			expect(bytesOf(source)).toEqual([8, 9]);
		});

		it("takes a field written as a label, with a colon", () => {
			const source = `
.struct S
    a: .byte
    b: .word
.end
    .db S.b, .size(S)
`;
			expect(bytesOf(source)).toEqual([1, 3]);
		});

		it("takes a block in braces", () => {
			const source = `
.struct S {
    a .byte
    b .word
}
    .db S.b, .size(S)
`;
			expect(bytesOf(source)).toEqual([1, 3]);
		});

		it("counts a field without a name in the size, as padding", () => {
			const source = `
.struct S
    a .byte
      .res 3
    b .byte
.end
    .db S.b, .size(S)
`;
			expect(bytesOf(source)).toEqual([4, 5]);
		});

		it("can have no field", () => {
			const source = `
.struct S
.end
    .db .size(S)
`;
			expect(bytesOf(source)).toEqual([0]);
		});

		it("keeps the fields' names as written: another case is another name", () => {
			const source = `
.struct S
    Tile .byte
.end
    lda #S.tile
`;
			expect(() => bytesOf(source)).toThrow("'tile' is not a field of struct S: its fields are Tile.");
		});

		it("can have a field named size: .size() is its size", () => {
			const source = `
.struct S
    a    .byte
    size .word
.end
    .db S.size, .size(S)
`;
			expect(bytesOf(source)).toEqual([1, 3]);
		});

		it("is an object of its fields' offsets", () => {
			const source = `
${SPRITE}
.log .json(Sprite)
.log .has(Sprite, "tile"), .has(Sprite, "size")
`;
			const logs = logsOf(source);
			expect(logs).toContain('{"x":0,"y":1,"tile":2,"name":4}');
			expect(logs).toContain("1\t0");
		});

		it("is written to the symbol file as an object", () => {
			const assembler = newAssembler();
			assembler.assemble(SPRITE);
			expect(assembler.symbolTable.getDict().global?.SPRITE).toBe('const object = {"x":0,"y":1,"tile":2,"name":4} ;:2:9');
		});

		it("is a symbol of its namespace", () => {
			const source = `
.namespace gfx
.struct S
    a .byte
    b .byte
.end
.end namespace
    .db gfx::S.b, .size(gfx::S)
`;
			expect(bytesOf(source)).toEqual([1, 2]);
		});

		it("is a symbol of its .proc, unknown outside", () => {
			const source = `
.proc init
.struct S
    a .byte
    b .byte
.end
    lda #S.b
.end
    lda #S.b
`;
			expect(() => bytesOf(source)).toThrow("Undefined symbol 'S'.");
		});
	});

	describe("errors in a struct", () => {
		it.each([
			[".struct\n    a .byte\n.end", "A struct needs a name."],
			['.struct S "x"\n.end', `Unexpected '"x"' after the struct's name.`],
			[".struct S\n    a .byte\n    a .word\n.end", "Field 'a' is defined twice in struct S."],
			[".struct S\n    a .word 3\n.end", ".word in a struct takes no operand, it is 2 bytes: .res <count> reserves more."],
			[".struct S\n    a .byte 1\n.end", ".byte in a struct takes no operand, it is 1 byte: .res <count> reserves more."],
			[".struct S\n    a\n.end", "The field 'a' has no size: a field is .byte, .word, .long or .res <count>."],
			[".struct S\n    a .org $1000\n.end", ".org can't be in a struct: a field is .byte, .word, .long or .res <count>."],
			['.struct S\n    a .text "ab"\n.end', ".text can't be in a struct: a field is .byte, .word, .long or .res <count>."],
			[".struct S\n    a .res\n.end", ".res in a struct needs a count of bytes."],
			[".struct S\n    a .res 2, $FF\n.end", ".res in a struct takes a count only: a field has no value."],
			[".struct S\n    a .res -1\n.end", ".res count: -1 isn't a whole number of bytes (0 or more)."],
			[".struct S\n    a .res N\n.end\nN = 2", "Undefined symbol 'N'."],
			[".struct P\n    a .byte\n.end\n.struct S\n    p .res P\n.end", "A field can't be a struct yet: write .res .size(P) to reserve its bytes."],
			[".struct S\n    a .byte\n.end\n.struct S\n    a .byte\n.end", "Symbol 'S' redefined."],
		])("%s", (source, message) => {
			expect(() => bytesOf(source)).toThrow(message);
		});

		it("is located at the field", () => {
			const source = `
.struct S
    a .byte
    b .word 3
.end
`;
			expect(() => bytesOf(source)).toThrow(expect.objectContaining({ location: expect.objectContaining({ line: 4, column: 13 }) }));
		});
	});

	describe("an instance", () => {
		it("from .res: reserves the struct's size, its label the address of its fields", () => {
			const source = `
${SPRITE}
    jmp start
player: .res Sprite
start:
    lda player
    lda player.tile, x
    lda player.name + 1
    ldy #.size(player)
`;
			expect(bytesOf(source)).toEqual([
				0x4c,
				0x0f,
				0x10, // jmp start
				...Array.from({ length: 12 }, () => 0), // player at $1003
				0xad,
				0x03,
				0x10, // lda player
				0xbd,
				0x05,
				0x10, // lda player.tile, x
				0xad,
				0x08,
				0x10, // lda player.name + 1
				0xa0,
				0x0c, // ldy #.size(player)
			]);
		});

		it("from .res, a label without a colon, and a filler", () => {
			const source = `
.struct S
    a .byte
    b .byte
.end
p   .res S, $FF
    lda #<p.b
`;
			expect(bytesOf(source)).toEqual([0xff, 0xff, 0xa9, 0x01]);
		});

		it("from .res, used before it's defined", () => {
			const source = `
.struct S
    a .byte
    b .byte
.end
    lda p.b
    ldy #.size(p)
p:  .res S
`;
			expect(bytesOf(source)).toEqual([0xad, 0x06, 0x10, 0xa0, 0x02, 0x00, 0x00]);
		});

		it("from .res without a label: only the bytes", () => {
			const source = `
.struct S
    a .word
.end
    .res S
`;
			expect(bytesOf(source)).toEqual([0, 0]);
		});

		it("from = … as, .equ … as, .let … as: an address, no bytes", () => {
			const source = `
.struct S
    a .byte
    b .byte
.end
p = $80 as S
q .equ $0300 as S
.let r = $90 as S
    lda p.b
    lda q.b
    lda r.b
    ldy #.size(q)
`;
			expect(bytesOf(source)).toEqual([0xa5, 0x81, 0xad, 0x01, 0x03, 0xa5, 0x91, 0xa0, 0x02]);
		});

		it("from as, used before it's defined", () => {
			const source = `
.struct S
    a .byte
    b .byte
.end
    lda p.b
p = $0300 as S
`;
			expect(bytesOf(source)).toEqual([0xad, 0x01, 0x03]);
		});

		it("of a struct in a namespace", () => {
			const source = `
.namespace gfx
.struct S
    a .byte
    b .byte
.end
.end namespace
p = $80 as gfx::S
    lda p.b
`;
			expect(bytesOf(source)).toEqual([0xa5, 0x81]);
		});

		it("given to a macro: its parameter is an instance too", () => {
			const source = `
.struct S
    a .byte
    b .byte
.end
.macro clear spr
    sta spr.b
.end
p = $80 as S
    clear p
`;
			expect(bytesOf(source)).toEqual([0x85, 0x81]);
		});

		it("in a relocatable segment: a relocatable address", () => {
			const assembler = new Assembler(new Cpu6502Handler(), new MockFileHandler(), { logger: new Logger({ sink: new MemorySink(), enabled: false }) });
			assembler.assemble(`
.segment CODE { reloc: true }
.segment CODE
.struct S
    a .byte
    b .byte
.end
    nop
p:  .res S
field = p.b
`);
			expect(assembler.symbolTable.getDict().global?.FIELD).toMatch(/^var reloc = CODE\+\$0002 ;/);
		});

		it("is no instance once assigned without as", () => {
			const source = `
.struct S
    a .byte
.end
p = $80 as S
p = $90
    lda p.a
`;
			expect(() => bytesOf(source)).toThrow("Invalid property access on a non-object value.");
		});
	});

	describe("errors on an instance", () => {
		it.each([
			[`${SPRITE}\np = $80 as Sprite\n    lda p.color`, "'color' is not a field of struct Sprite: its fields are x, y, tile, name."],
			["x = 1\np = $80 as x", "'x' is not a struct."],
			["p = $80 as S", "Undefined symbol 'S'."],
			[`${SPRITE}\np = "ab" as Sprite`, `An instance of Sprite is an address: "ab" isn't one.`],
			[`${SPRITE}\np = as Sprite`, "Missing the address before 'as'."],
			[`${SPRITE}\n* = $1000 as Sprite`, "The PC is an address, not an instance of a struct: '* =' takes no 'as'."],
			["x = 1\n    lda #.size(x)", ".SIZE() takes a struct, or an instance of one: 'X' is neither."],
			["    lda #.size(5)", ".SIZE() takes a struct, or an instance of one: .size(Sprite), .size(player)."],
			["    lda #.size(nope)", "Undefined symbol 'NOPE'."],
		])("%s", (source, message) => {
			expect(() => bytesOf(source)).toThrow(message);
		});
	});
});
