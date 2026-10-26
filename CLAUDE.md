# tsAsm — working notes

Multi-CPU assembler in TypeScript (6502, 65C02, 6809, RV32I, ARM stub), usable as a CLI or a library.

## Where things are

- `README.md`: install, CLI, project file, library API.
- `REFERENCE.md`: the assembler language. Update it when a behaviour changes.
- `TODO.md`: what's left to do, numbered (1.x bugs, 2.x code review, 3.x syntax design questions, 4.x features, 5.x documentation).
- `CHANGELOG.md`: what's done, by PR, with its TODO number.
- `src/assembler` (parser, expressions, symbols, `polyasm.ts`), `src/directives`, `src/cpu`, `src/linker`, `src/cli`, tests in `src/tests`.

## Commands

- `pnpm test`, `pnpm check` (tsc), `pnpm lint:ci`: what CI runs, with `pnpm bundle`.
- **Checking the CLI:** build it with `pnpm exec rollup -c rollup.config.js --environment TARGET:cli` (`pnpm build:cli` bumps the version since #70), then run `node dist/tsasm proj.yaml` on a small project.
- **`pnpm-workspace.yaml` is committed** since #71: it holds the pnpm 12 `allowBuilds` settings.

## How we work

- **One small PR per fix.** Keep unrelated findings out of it: list them as follow-ups in `TODO.md`.
- **Behaviour and design choices are the maintainer's** (error vs warning, accepted ranges, semantics): ask, with options and a recommendation, before deciding.
- For each fix:
    - reproduce on `main` first;
    - show a `main` vs PR table in the PR;
    - check that the new tests fail on `main`;
    - keep `tsc` at 0 errors and lint at 0 warnings.
- **Done items move to `CHANGELOG.md`:** under their area, newest PR first, headed by the PR and their TODO number (other items refer to them by it), the fix in _italics_ after the problem. Items keep their numbers in `TODO.md`: a done one leaves a gap.

## Design rules

- **Explicit, always:** something the assembler doesn't understand is an error, never silently ignored or truncated.
- **Loops (`.repeat`, `.for`) are line generators, like the C preprocessor, not scopes:** what the body defines stays where the loop is, and only the iterators are local. Macros do have a scope per call.
- **Errors:**
    - throw `AsmError.at(message, token)` when a token is at hand, else a plain `Error` (the assembler locates it at the statement);
    - messages say _what_ is wrong, never "on line N";
    - warnings go through `assembler.warn()` / `runtime.warn()`.
