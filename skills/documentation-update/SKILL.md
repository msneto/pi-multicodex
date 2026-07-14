---
name: documentation-update
description: Keeps README, ROADMAP, docs, changelog, and release notes aligned after user-visible changes. Use when commands, storage, rotation, packaging, or docs-routing change.
---

# Documentation Update

## Quick start

1. Read `docs/README.md` for the docs map.
2. Update the user-facing doc first if behavior changed.
3. Update the deeper reference doc next.
4. Update `ROADMAP.md` only for future work.
5. Re-read the edited docs and check for drift.

## Workflow

- Keep `README.md` user-facing and concise.
- Keep `ROADMAP.md` future-facing; do not repeat implemented facts there.
- Put current-state architecture in `docs/architecture.md`.
- Put local workflow in `docs/local-development.md`.
- Put test guidance in `docs/testing-reference.md`.
- Put rotation behavior in `docs/domains/rotation.md`.
- Keep report and learnings links in `docs/context-engineering/` and `docs/references/`.

## Good triggers

- Command surface changes under `/multicodex`
- Rotation or storage contract changes
- New validation commands or packaging rules
- Release note or README updates after implementation

## Notes

- Update the docs and tests together when behavior changes.
- Keep links repo-local and verify they point to real files.
- Run `bun run check` when docs affect shipped behavior or published files.
