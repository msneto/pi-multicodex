# MultiCodex Agent Notes

## Scope

- Edit only files in this repository.
- Keep `/multicodex` as the only operator command surface. Do not reintroduce `/multicodex-use`, `/multicodex-status`, or `/multicodex-footer`.
- Use public exports from `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui`; avoid repo-local deep imports.
- Use `paths.ts` for all `~/.pi/agent/*` path resolution.
- Keep README user-facing, ROADMAP future-facing, and deeper canonical docs in `docs/`.
- Prefer docs over stale prose. Read `docs/README.md`, `docs/architecture.md`, `docs/local-development.md`, `docs/testing-reference.md`, `docs/references/project-learnings.md`, `docs/decisions/`, and `docs/context-engineering/` when relevant.

## Working rules

- Keep command UX, rotation behavior, storage schema, tests, and release notes in sync when they change.
- Keep config, runtime status, and UI wiring separate.
- Normalize config on load and save.
- Keep hooks and command handlers thin; prefer small focused modules.
- Do not batch unrelated changes into one large commit.
- Use conventional commit messages for commits.

## Validation

- Run `bun run check` for the standard repo check.
- Run `npm pack --dry-run` before release-bound changes.
- Use `bun run release:dry` for release verification.
- Keep `lefthook` and `mise run pre-push` aligned with local validation.
