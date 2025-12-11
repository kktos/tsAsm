import { blockDirectives, rawDirectives } from "../../assembler/parser.class";
import type { Assembler } from "../../assembler/polyasm";
import { AlignDirective } from "../../directives/align.directive";
import type { DirectiveContext, IDirective } from "../../directives/directive.interface";
import { EndDirective } from "../../directives/end.directive";
import { FillDirective } from "../../directives/fill.directive";
import { IfDirective } from "../../directives/if.directive";
import { LogDirective } from "../../directives/log.directive";
import { LoopDirective } from "../../directives/loop.directive";
import { SegmentDirective } from "../../directives/segment.directive";
import type { Logger } from "../../helpers/logger.class";
import type { ScalarToken } from "../../lexer/lexer.class";
import type { Linker } from "../linker.class";
import { AssignDirective } from "./assign.directive";
import { OutputDirective } from "./output.directive";
import { WriteDirective } from "./write.directive";

export class Dispatcher {
	private readonly directiveMap: Map<string, IDirective>;
	constructor(
		linker: Linker,
		private readonly assembler: Assembler,
		readonly logger: Logger,
	) {
		this.assembler = assembler;
		this.directiveMap = new Map();

		const loopHandler = new LoopDirective();
		this.register("FOR", loopHandler);
		this.register("REPEAT", loopHandler);
		this.register("=", new AssignDirective());

		this.register("LOG", new LogDirective("LOG"));
		this.register("ERROR", new LogDirective("ERR"));
		this.register("WARNING", new LogDirective("WARN"));

		this.register("FILL", new FillDirective());
		this.register("ALIGN", new AlignDirective());
		this.register("SEGMENT", new SegmentDirective());
		this.register("IF", new IfDirective());
		this.register("END", new EndDirective());

		this.register("OUTPUT", new OutputDirective(linker));
		this.register("WRITE", new WriteDirective(linker));
	}

	public register(name: string, handler: IDirective): void {
		if (handler.isBlockDirective) blockDirectives.add(name);
		if (handler.isRawDirective) rawDirectives.add(name);

		this.directiveMap.set(name, handler);
	}

	public dispatch(directive: ScalarToken, context: DirectiveContext) {
		const handler = this.directiveMap.get(directive.value);
		if (!handler) return false;
		handler.handlePassOne(directive, this.assembler, context);
		return true;
	}
}
