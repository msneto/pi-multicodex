---
name: verification-workflow
description: Verifies the smallest safe change set before merge. Use when preparing code, docs, or packaging changes, or when choosing targeted checks before `bun run check`, `bun run context-check`, or `npm pack --dry-run`.
---

# Verification Workflow

## Quick start

1. Read the owning docs first: `docs/architecture.md`, `docs/testing-reference.md`, and any module-specific docs.
2. Run the narrowest relevant test file first.
3. Expand to related tests only after the narrow run passes.
4. Finish with `bun run check`.
5. Run `npm pack --dry-run` when the change affects shipped files, docs, or packaging.

## Workflow

- Prefer the smallest test lane that covers the changed files.
- Keep the check order stable: targeted test -> related tests -> repo check -> pack dry-run.
- Stop on the first failure and fix the smallest failing file group.
- Re-read the diff before ending; verify only the intended files changed.

## Good triggers

- Behavior changes in `selection.ts`, `account-manager.ts`, `stream-wrapper.ts`, or `report.ts`
- Docs updates in `README.md`, `ROADMAP.md`, or `docs/`
- Packaging changes that affect `package.json.files` or the tarball contents

## Notes

- `bun run check` is the standard repo lane.
- `npm pack --dry-run` checks the published file set.
