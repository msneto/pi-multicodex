---
name: bugfix-workflow
description: Reproduces and isolates regressions before applying a minimal fix. Use when debugging failing tests, broken runtime behavior, or unexpected report output.
---

# Bugfix Workflow

## Quick start

1. Reproduce the bug with the smallest command or test that fails.
2. Read the owning module and its nearest tests.
3. Trace the failure to one file group.
4. Fix the root cause with the smallest behavior change.
5. Add or update a regression test.
6. Re-run the narrow test before widening validation.

## Workflow

- Prefer module-local diagnosis over broad repo probing.
- Use `docs/architecture.md` to find the owning boundary quickly.
- Use `docs/testing-reference.md` to pick the right test lane.
- Keep the fix reversible and easy to explain.
- Do not mix unrelated cleanup into the bug fix.

## Good triggers

- Rotation or selection regressions in `selection.ts` or `index.test.ts`
- Storage or settings load/save bugs in `storage.ts` or `rotation-settings.ts`
- UI or report mismatches in `multicodex-controller.ts`, `commands.ts`, or `report.ts`
- Hook or session lifecycle failures in `hooks.ts` or `status.ts`

## Notes

- Reproduce first, then patch.
- Target the regression test at the owning file.
- End with `bun run check` when the bug is fixed.
