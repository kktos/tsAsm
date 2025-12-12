import { blockDirectives, rawDirectives } from "../../assembler/parser.class";
import { AlignDirective } from "../../directives/align.directive";
import type { DirectiveContext, DirectiveRuntime, IDirective } from "../../directives/directive.interface";
import { EndDirective } from "../../directives/end.directive";
import { FillDirective } from "../../directives/fill.directive";
import { IfDirective } from "../../directives/if.directive";
import { LogDirective } from "../../directives/log.directive";
import { LoopDirective } from "../../directives/loop.directive";
import { SegmentDirective } from "../../directives/segment.directive";
import type { ScalarToken } from "../../shared/lexer/lexer.class";
import type { Linker } from "../linker.class";
import { AssignDirective } from "./assign.directive";
import { EndianDirective } from "./endian.directive";
import { OutputDirective } from "./output.directive";
import { WriteDirective } from "./write.directive";

export class Dispatcher {
	private readonly directiveMap: Map<string, IDirective>;

	constructor(linker: Linker, runtime: DirectiveRuntime) {
		this.directiveMap = new Map();

		const loopHandler = new LoopDirective(runtime);
		this.register("FOR", loopHandler);
		this.register("REPEAT", loopHandler);

		this.register("=", new AssignDirective(runtime));

		this.register("LOG", new LogDirective(runtime, "LOG"));
		this.register("ERROR", new LogDirective(runtime, "ERR"));
		this.register("WARNING", new LogDirective(runtime, "WARN"));

		this.register("FILL", new FillDirective(runtime));
		this.register("ALIGN", new AlignDirective(runtime));
		this.register("SEGMENT", new SegmentDirective(runtime));
		this.register("IF", new IfDirective(runtime));
		this.register("END", new EndDirective(runtime));

		this.register("ENDIAN", new EndianDirective(runtime, linker));
		this.register("OUTPUT", new OutputDirective(runtime, linker));
		this.register("WRITE", new WriteDirective(runtime, linker));
	}

	public register(name: string, handler: IDirective): void {
		if (handler.isBlockDirective) blockDirectives.add(name);
		if (handler.isRawDirective) rawDirectives.add(name);

		this.directiveMap.set(name, handler);
	}

	public dispatch(directive: ScalarToken, context: DirectiveContext) {
		const handler = this.directiveMap.get(directive.value);
		if (!handler) return false;
		handler.handlePassOne(directive, context);
		return true;
	}
}
