import type { DirectiveContext } from "../../directives/directive.interface";
import { MacroDirective } from "../../directives/macro/macro.directive";
import type { ScalarToken } from "../../shared/lexer/lexer.class";

export class LinkerMacroDirective extends MacroDirective {
	public handlePassTwo(directive: ScalarToken, _context: DirectiveContext) {
		this.handleMacroDefinition(directive, _context);
	}
}
