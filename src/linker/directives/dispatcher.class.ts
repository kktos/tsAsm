import { blockDirectives, rawDirectives } from "../../assembler/parser.class";
import { AlignDirective } from "../../directives/align.directive";
import { DataDirective } from "../../directives/data.directive";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import { EndDirective } from "../../directives/end.directive";
import { FillDirective } from "../../directives/fill.directive";
import { IfDirective } from "../../directives/if.directive";
import { LogDirective } from "../../directives/log.directive";
import { LoopDirective } from "../../directives/loop.directive";
import { StringDirective } from "../../directives/string.directive";
import type { ScalarToken } from "../../shared/lexer/lexer.class";
import { AssignDirective } from "./assign.directive";
import { EndianDirective } from "./endian.directive";
import { LinkerMacroDirective } from "./linkermacro.directive";
import { OutputDirective } from "./output.directive";
import { SectionDirective } from "./segment.directive";
import { WriteDirective } from "./write.directive";

export class Dispatcher {
	private readonly directiveMap: Map<string, IDirective>;

	constructor(runtime: DirectiveRuntime) {
		this.directiveMap = new Map();

		const loopHandler = new LoopDirective(runtime);
		this.register("FOR", loopHandler);
		this.register("REPEAT", loopHandler);
		this.register("MACRO", new LinkerMacroDirective(runtime));

		this.register("=", new AssignDirective(runtime));

		this.register("LOG", new LogDirective(runtime, "LOG"));
		this.register("ERROR", new LogDirective(runtime, "ERR"));
		this.register("WARNING", new LogDirective(runtime, "WARN"));

		this.register("FILL", new FillDirective(runtime));
		this.register("ALIGN", new AlignDirective(runtime));
		this.register("BYTE", new DataDirective(runtime, 1)); // Define Byte (1 byte)
		this.register("WORD", new DataDirective(runtime, 2)); // Define Word (2 bytes)
		this.register("LONG", new DataDirective(runtime, 4)); // Define Long (4 bytes)
		this.register("STRING", new StringDirective(runtime, "TEXT"));
		this.register("PSTRING", new StringDirective(runtime, "PSTR"));
		this.register("PSTRINGLONG", new StringDirective(runtime, "PSTRL"));
		this.register("CSTRING", new StringDirective(runtime, "CSTR"));

		this.register("SECTION", new SectionDirective(runtime));
		this.register("IF", new IfDirective(runtime));
		this.register("END", new EndDirective(runtime));

		this.register("ENDIAN", new EndianDirective(runtime));
		this.register("OUTPUT", new OutputDirective(runtime));
		this.register("WRITE", new WriteDirective(runtime));
	}

	public register(name: string, handler: IDirective): void {
		if (handler.isBlockDirective) blockDirectives.add(name);
		if (handler.isRawDirective) rawDirectives.set(name, handler.getRawBlock);

		this.directiveMap.set(name, handler);
	}

	public dispatch(directive: ScalarToken, context: DirectiveContext) {
		const handler = this.directiveMap.get(directive.value);
		if (!handler) return false;
		handler.handlePassTwo(directive, context);
		return true;
	}
}
