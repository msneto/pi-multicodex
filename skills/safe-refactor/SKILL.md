---
name: safe-refactor
description: Refactors code without changing behavior. Use when simplifying modules, moving logic between files, or reducing duplication while preserving current output and tests.
---

# Safe Refactor

## Quick start

1. Read `docs/architecture.md` to confirm the module boundary.
2. Identify one small refactor target.
3. Keep public behavior and file ownership stable.
4. Move one piece at a time.
5. Re-run the smallest relevant tests after each step.

## Workflow

- Prefer mechanical moves over redesign.
- Preserve the current command surface, storage shape, and rotation defaults.
- Keep config, runtime state, and UI wiring separate.
- If the refactor touches output text, update the nearest assertions at the same time.
- Re-read the diff before moving to the next file group.

## Good triggers

- Splitting a large module into smaller focused files
- Removing duplicated normalization or formatting logic
- Moving controller-owned logic out of command handlers
- Simplifying selection, reporting, or storage helpers

## Notes

- Use `docs/testing-reference.md` to choose targeted tests.
- Avoid bundling refactors with behavior changes unless the change is already planned.
- Finish with `bun run check` when the refactor is complete.
