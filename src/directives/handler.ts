/**
 * handler.ts
 *
 * * Defines the logic for handling assembler directives during different passes.
 * * Acts as a dispatcher to specialized directive handlers.
 */

import type { Parser } from "../assembler/parser.class";
import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import { AlignDirective } from "./align.directive";
import { AssertDirective } from "./assert.directive";
import { AssignDirective } from "./assign.directive";
import { BreakDirective } from "./break.directive";
import { CpuDirective } from "./cpu.directive";
import { DataDirective } from "./data.directive";
import { DefineDirective } from "./define.directive";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";
import { EndDirective } from "./end.directive";
import { EquDirective } from "./equ.directive";
import { ExitMacroDirective } from "./exitmacro.directive";
import { FillDirective } from "./fill.directive";
import { FunctionDirective } from "./function.directive";
import { HexDirective } from "./hex.directive";
import { IfDirective } from "./if.directive";
import { IncbinDirective } from "./incbin.directive";
import { IncludeDirective } from "./include.directive";
import { LetDirective } from "./let.directive";
import { ListDirective } from "./list.directive";
import { LogDirective } from "./log.directive";
import { LoopDirective } from "./loop.directive";
import { MacroDirective } from "./macro/macro.directive";
import { ModuleDirective } from "./module.directive";
import { NamespaceDirective } from "./namespace.directive";
import { OnceDirective } from "./once.directive";
import { OptionDirective } from "./option.directive";
import { OrgDirective } from "./org.directive";
import { ProcDirective } from "./proc.directive";
import { SegmentDirective } from "./segment.directive";
import { StringDirective } from "./string.directive";

export class DirectiveHandler {
	private readonly directiveMap: Map<string, IDirective>;
	private readonly parser: Parser;
	constructor(assembler: Assembler, runtime: DirectiveRuntime) {
		this.directiveMap = new Map();
		this.parser = runtime.parser;
		const cpuEndianness = () => assembler.getCPUHandler().endianness;

		this.register("ORG", new OrgDirective(assembler));
		this.register("MACRO", new MacroDirective(runtime));

		this.register("NAMESPACE", new NamespaceDirective(assembler));

		const procDirective = new ProcDirective(assembler, runtime.lister);
		this.register("PROC", procDirective);
		this.register("PROCEDURE", procDirective);
		const functionDirective = new FunctionDirective(runtime.parser);
		this.register("FUNCTION", functionDirective);
		this.register("FN", functionDirective);

		this.register("DEFINE", new DefineDirective(assembler, runtime.lister));
		this.register("EQU", new EquDirective(assembler, runtime.lister));
		this.register("=", new AssignDirective(assembler, runtime.lister));
		this.register("LET", new LetDirective(assembler, runtime.lister));

		this.register("OPTION", new OptionDirective(assembler));
		this.register("INCLUDE", new IncludeDirective(assembler, runtime));
		this.register("ONCE", new OnceDirective(assembler));
		this.register("INCBIN", new IncbinDirective(assembler, runtime.lister));

		this.register("HEX", new HexDirective(assembler, runtime.lister));
		this.register("DB", new DataDirective(runtime, 1, cpuEndianness)); // Define Byte (1 byte)
		this.register("BYTE", new DataDirective(runtime, 1, cpuEndianness)); // Define Byte (1 byte)
		this.register("DW", new DataDirective(runtime, 2, cpuEndianness)); // Define Word (2 bytes)
		this.register("WORD", new DataDirective(runtime, 2, cpuEndianness)); // Define Word (2 bytes)
		this.register("DL", new DataDirective(runtime, 4, cpuEndianness)); // Define Long (4 bytes)
		this.register("LONG", new DataDirective(runtime, 4, cpuEndianness)); // Define Long (4 bytes)

		const strHandler = new StringDirective(runtime, "TEXT", cpuEndianness);
		this.register("TEXT", strHandler);
		this.register("STR", strHandler);
		this.register("STRING", strHandler);
		const cstrHandler = new StringDirective(runtime, "CSTR", cpuEndianness);
		this.register("CSTR", cstrHandler);
		this.register("CSTRING", cstrHandler);
		this.register("ASCIIZ", cstrHandler);
		this.register("PSTR", new StringDirective(runtime, "PSTR", cpuEndianness));
		this.register("PSTRL", new StringDirective(runtime, "PSTRL", cpuEndianness));

		const loopHandler = new LoopDirective(runtime);
		this.register("FOR", loopHandler);
		this.register("REPEAT", loopHandler);

		this.register("LIST", new ListDirective(assembler, runtime.logger));

		const logHandler = new LogDirective(runtime, "LOG");
		this.register("LOG", logHandler);
		this.register("ECHO", logHandler);
		this.register("OUT", logHandler);

		const errLogHandler = new LogDirective(runtime, "ERR");
		this.register("ERROR", errLogHandler);
		this.register("ERR", errLogHandler);

		const warnLogHandler = new LogDirective(runtime, "WARN");
		this.register("WARNING", warnLogHandler);
		this.register("WARN", warnLogHandler);

		this.register("ASSERT", new AssertDirective(runtime));

		this.register("BREAK", new BreakDirective(runtime));

		const exitMacroHandler = new ExitMacroDirective(runtime);
		this.register("EXITMACRO", exitMacroHandler);
		this.register("EXITM", exitMacroHandler);

		const fillHandler = new FillDirective(runtime);
		this.register("FILL", fillHandler);
		this.register("DS", fillHandler);
		this.register("RES", fillHandler);

		this.register("ALIGN", new AlignDirective(runtime));

		this.register("SEGMENT", new SegmentDirective(runtime));
		this.register("MODULE", new ModuleDirective(runtime));

		const cpuDirective = new CpuDirective(assembler, runtime.lister);
		this.register("CPU", cpuDirective);
		this.register("SETCPU", cpuDirective);
		this.register("PROCESSOR", cpuDirective);

		this.register("IF", new IfDirective(runtime));
		this.register("END", new EndDirective(runtime));
	}

	public register(name: string, handler: IDirective): void {
		this.parser.registerDirective(name, handler);

		this.directiveMap.set(name, handler);
	}

	public handlePassOneDirective(directive: ScalarToken, context: DirectiveContext) {
		const handler = this.directiveMap.get(directive.value);
		if (!handler) return false;
		handler.handlePassOne(directive, context);
		return true;
	}

	public handlePassTwoDirective(directive: ScalarToken, context: DirectiveContext) {
		const handler = this.directiveMap.get(directive.value);
		if (handler) handler.handlePassTwo(directive, context);
	}
}
