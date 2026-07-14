# Architecture

This extension is organized around a few small modules with clear ownership boundaries.

## Runtime flow

```text
pi extension startup
  -> index.ts
  -> extension.ts
  -> provider.ts / commands.ts / hooks.ts / status.ts

request handling
  -> provider.ts
  -> stream-wrapper.ts
  -> account-manager.ts
  -> selection.ts
  -> report.ts

operator flow
  -> commands.ts
  -> account-flows.ts
  -> multicodex-controller.ts
  -> account-manager.ts / rotation-settings.ts / storage.ts
```

## Module map

| File | Responsibility |
| --- | --- |
| `index.ts` | Extension entrypoint. |
| `extension.ts` | Wires the extension into pi. |
| `provider.ts` | Overrides the normal `openai-codex` provider path and installs the managed stream wrapper. |
| `stream-wrapper.ts` | Handles account selection, retries, and quota-rotation during streaming. |
| `account-manager.ts` | Owns managed account storage, token refresh, usage cache, activation logic, and auth import sync. |
| `selection.ts` | Implements rotation strategy selection. |
| `rotation-settings.ts` | Normalizes persisted rotation settings. |
| `storage.ts` | Reads and writes managed account state through the shared agent-path helpers. |
| `auth.ts` | Reads pi auth and extracts importable `openai-codex` OAuth state. |
| `multicodex-controller.ts` | Owns durable config, runtime summaries, verification, and reset behavior. |
| `account-flows.ts` | Contains account-picker orchestration and other UI flow glue. |
| `commands.ts` | Dispatches `/multicodex` subcommands and autocomplete. |
| `hooks.ts` | Runs session-start and session-switch refresh behavior. |
| `status.ts` | Renders the footer and manages footer settings UI. |
| `report.ts` | Formats selection, retry, and account-status reports. |
| `usage.ts`, `usage-client.ts`, `usage-history.ts` | Fetch, parse, and cache usage data. |
| `quota.ts` | Classifies quota and rate-limit failures. |
| `browser.ts` | Opens login URLs in the browser. |
| `abort-utils.ts` | Links abort controllers for stream cancellation. |
| `paths.ts` | Centralizes `~/.pi/agent/*` path resolution. |

## Boundaries

- `provider.ts` and `stream-wrapper.ts` own runtime account choice during requests.
- `multicodex-controller.ts` owns persisted config and user-facing summaries.
- `account-manager.ts` owns managed-account state and activation transitions.
- `commands.ts` stays thin and delegates orchestration to `account-flows.ts` and the controller.
- `status.ts` owns footer-specific settings and rendering, not general account storage.
- `selection.ts` stays focused on choosing among already-loaded candidates.

## Cross-cutting concerns

- **Single command surface.** The operator surface stays under `/multicodex`.
- **Persistence.** Config and account state are normalized on load and save.
- **Rotation policy.** `lowest-usage` remains the default strategy; `stable-weekly` and `capacity-first` are opt-in alternatives.
- **Manual state.** Active/manual override state, quota cooldowns, and manual disable flags are carried through selection and reporting.
- **Reporting.** Reports explain why an account won, lost, retried, or fell back.
- **Session lifecycle.** Hooks refresh state during session changes so UI surfaces stay in sync.
- **Local paths.** All `~/.pi/agent/*` paths flow through shared helpers instead of hard-coded joins.

## Verification surface

- Root tests live as `*.test.ts` files.
- `bun run check` is the main local validation lane.
- `npm pack --dry-run` verifies the published file set.
- Behavior changes should include targeted tests near the owning module.

## Read first for changes

- `README.md` for user-facing behavior
- `ROADMAP.md` for future work
- `docs/references/project-learnings.md` for durable lessons
- `docs/decisions/` for prior design decisions
