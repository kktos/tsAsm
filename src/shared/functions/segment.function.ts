import type { Segment } from "../../linker/linker.class";
import { AsmError } from "../../utils/error.utils";
import type { IFunctionDef } from "./types";

/**
 * `.segment(name)`: the segment `findSegment` knows by that name.
 * In pass 1, a segment defined further down isn't known yet: `null`.
 */
export function segmentFunction(findSegment: (name: string) => Segment | undefined): IFunctionDef {
	return {
		handler: (stack, token, _symbolTable, _argCount, _resolver, allowForwardRef) => {
			const segName = stack.pop();
			if (typeof segName !== "string") throw AsmError.at("Argument to .SEGMENT() must be a string.", token);
			const seg = findSegment(segName);
			if (seg) stack.push(seg);
			else if (allowForwardRef) stack.push(null);
			else throw AsmError.at(`Segment '${segName}' not found.`, token);
		},
		minArgs: 1,
		maxArgs: 1,
	};
}
