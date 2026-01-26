/**
 * handler.ts
 *
 * * Defines the logic for handling assembler directives during different passes.
 * * Acts as a dispatcher to specialized directive handlers.
 */

import { blockDirectives, rawDirectives } from "../assembler/parser.class";
import type { Assembler } from "../assembler/polyasm";
import type { ScalarToken } from "../shared/lexer/lexer.class";
import { AlignDirective } from "./align.directive";
import { AssignDirective } from "./assign.directive";
import { CpuDirective } from "./cpu.directive";
import { DataDirective } from "./data.directive";
import { DefineDirective } from "./define.directive";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "./directive.interface";
import { EndDirective } from "./end.directive";
import { EquDirective } from "./equ.directive";
import { ExportDirective } from "./export.directive";
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
import { OptionDirective } from "./option.directive";
import { OrgDirective } from "./org.directive";
import { SegmentDirective } from "./segment.directive";
import { StringDirective } from "./string.directive";

export class DirectiveHandler {
	private readonly directiveMap: Map<string, IDirective>;
	constructor(assembler: Assembler, runtime: DirectiveRuntime) {
		this.directiveMap = new Map();

		this.register("ORG", new OrgDirective(assembler, runtime.logger));
		this.register("MACRO", new MacroDirective(runtime));

		this.register("NAMESPACE", new NamespaceDirective(assembler));
		this.register("EXPORT", new ExportDirective(assembler, runtime.lister));

		const functionDirective = new FunctionDirective(assembler, runtime.lister);
		this.register("FUNCTION", functionDirective);

		this.register("DEFINE", new DefineDirective(assembler, runtime.lister));
		this.register("EQU", new EquDirective(assembler, runtime.lister));
		this.register("=", new AssignDirective(assembler, runtime.lister));
		this.register("LET", new LetDirective(assembler, runtime.lister));

		this.register("OPTION", new OptionDirective(assembler, runtime.logger));
		this.register("INCLUDE", new IncludeDirective(assembler, runtime.lister));
		this.register("INCBIN", new IncbinDirective(assembler, runtime.logger));

		this.register("HEX", new HexDirective(assembler, runtime.logger, runtime.lister));
		this.register("DB", new DataDirective(runtime, 1)); // Define Byte (1 byte)
		this.register("BYTE", new DataDirective(runtime, 1)); // Define Byte (1 byte)
		this.register("DW", new DataDirective(runtime, 2)); // Define Word (2 bytes)
		this.register("WORD", new DataDirective(runtime, 2)); // Define Word (2 bytes)
		this.register("DL", new DataDirective(runtime, 4)); // Define Long (4 bytes)
		this.register("LONG", new DataDirective(runtime, 4)); // Define Long (4 bytes)

		this.register("TEXT", new StringDirective(runtime, "TEXT"));
		const cstrHandler = new StringDirective(runtime, "CSTR");
		this.register("CSTR", cstrHandler);
		this.register("CSTRING", cstrHandler);
		this.register("ASCIIZ", cstrHandler);
		this.register("PSTR", new StringDirective(runtime, "PSTR"));
		this.register("PSTRL", new StringDirective(runtime, "PSTRL"));

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
		if (handler.isBlockDirective) blockDirectives.add(name);
		if (handler.isRawDirective) rawDirectives.set(name, handler.getRawBlock);

		this.directiveMap.set(name, handler);
	}

	public handlePassOneDirective(directive: ScalarToken, context: DirectiveContext) {
		const handler = this.directiveMap.get(directive.value);
		// if (directive.value === "CPU" && context.macroArgs)
		// 	throw new Error(`ERROR on line ${directive.line}: The .CPU directive cannot be used inside a macro. Please set the CPU outside of macro definitions.`);
		if (!handler) return false;
		handler.handlePassOne(directive, context);
		return true;
	}

	public handlePassTwoDirective(directive: ScalarToken, context: DirectiveContext) {
		const handler = this.directiveMap.get(directive.value);
		if (handler) handler.handlePassTwo(directive, context);
	}
}
