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
import type { ScalarToken } from "../../shared/lexer/lexer.class";
import type { Linker } from "../linker.class";
import { AssignDirective } from "./assign.directive";
import { EndianDirective } from "./endian.directive";
import { OutputDirective } from "./output.directive";
import { WriteDirective } from "./write.directive";

export class Dispatcher {
	private readonly directiveMap: Map<string, IDirective>;
	constructor(
		linker: Linker,
		assembler: Assembler,
		readonly logger: Logger,
	) {
		this.directiveMap = new Map();

		const loopHandler = new LoopDirective(assembler, assembler.lister);
		this.register("FOR", loopHandler);
		this.register("REPEAT", loopHandler);
		this.register("=", new AssignDirective(assembler));

		this.register("LOG", new LogDirective(assembler, logger, "LOG"));
		this.register("ERROR", new LogDirective(assembler, logger, "ERR"));
		this.register("WARNING", new LogDirective(assembler, logger, "WARN"));

		this.register("FILL", new FillDirective(assembler, logger));
		this.register("ALIGN", new AlignDirective(assembler, logger));
		this.register("SEGMENT", new SegmentDirective(assembler, assembler.lister));
		this.register("IF", new IfDirective(assembler));
		this.register("END", new EndDirective(assembler));

		this.register("ENDIAN", new EndianDirective(assembler.parser, linker));
		this.register("OUTPUT", new OutputDirective(assembler, linker));
		this.register("WRITE", new WriteDirective(assembler, linker));
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
