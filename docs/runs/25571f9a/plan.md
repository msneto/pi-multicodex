# Plan

## Summary

Implement the opt-in `capacity-first` rotation selector, persist the `manuallyDisabled` account state, and add the guard-relaxation toggle without changing the default `lowest-usage` behavior.

## Sources

- `/home/msneto/github/pi-multicodex/docs/runs/25571f9a/specs.md`
- `/home/msneto/github/pi-multicodex/AGENTS.md`
- `/home/msneto/github/pi-multicodex/README.md`
- `/home/msneto/github/pi-multicodex/ROADMAP.md`
- `/home/msneto/github/pi-multicodex/CHANGELOG.md`
- `/home/msneto/github/pi-multicodex/docs/decisions/2026-07-11-1545-rotation-capacity-scorer.md`
- `/home/msneto/github/pi-multicodex/selection.ts`
- `/home/msneto/github/pi-multicodex/rotation-settings.ts`
- `/home/msneto/github/pi-multicodex/storage.ts`
- `/home/msneto/github/pi-multicodex/account-manager.ts`
- `/home/msneto/github/pi-multicodex/stream-wrapper.ts`
- `/home/msneto/github/pi-multicodex/multicodex-controller.ts`
- `/home/msneto/github/pi-multicodex/account-flows.ts`
- `/home/msneto/github/pi-multicodex/report.ts`
- `/home/msneto/github/pi-multicodex/schemas/codex-accounts.schema.json`
- `/home/msneto/github/pi-multicodex/index.test.ts`
- `/home/msneto/github/pi-multicodex/report.test.ts`
- `/home/msneto/github/pi-multicodex/rotation-settings.test.ts`
- `/home/msneto/github/pi-multicodex/account-manager.test.ts`
- `/home/msneto/github/pi-multicodex/multicodex-controller.test.ts`
- `/home/msneto/github/pi-multicodex/commands.account-flow.test.ts`

## Scope

### In scope

- Add the `capacity-first` strategy as an opt-in selector.
- Persist a `guardRelaxation` rotation toggle with a default of `false`.
- Persist a `manuallyDisabled` account flag as a hard gate.
- Thread the selection path through the existing stream/account activation flow.
- Expose the new rotation setting and account toggle in the current UI surfaces.
- Update selection, reporting, and docs/tests to match the resolved contract.

### Out of scope

- Changing the default strategy away from `lowest-usage`.
- Adding new top-level commands or aliases.
- Predictive scheduling, telemetry modeling, or a broader auth redesign.
- Reworking unrelated footer or controller behavior.

## Current behavior / target behavior

### Current behavior

- `selection.ts` supports `lowest-usage` and `stable-weekly` only.
- `preferUntouched` is a hard preference when untouched accounts exist.
- Hard gates currently cover reauth and active quota cooldown.
- Storage does not persist a manual-disable account flag.
- Rotation settings do not include a guard-relaxation toggle.
- The account panel has no per-account disable/enable control.

### Target behavior

- `capacity-first` becomes an opt-in strategy name.
- `guarded-fit` remains a spec shorthand only.
- `manuallyDisabled` excludes an account as a hard gate.
- Untouched accounts become a bonus, not a filter.
- Missing or stale usage lowers confidence but does not hard-exclude accounts.
- Guard relaxation is only honored in `capacity-first` and defaults off.
- Manual disable overrides manual pin: if a currently pinned account is disabled, the pin is cleared immediately and rotation resumes with another eligible account.
- The operator disable/enable control lives inside `/multicodex accounts`.
- Reports explain fit class, guard state, penalties, fallback class, and retry reasons.

## Acceptance criteria

- `G1` / `AC1`: hard gates exclude reauth, manual disable, and active cooldown accounts.
- `G2` / `AC2` / `AC4` / `AC5`: `capacity-first` honors both windows, prefers the tightest safe fit, and never overrides safety.
- `G3` / `AC3` / `AC6` / `AC7`: preserve larger pockets, keep untouched as a bonus, and treat missing/stale usage as soft signals.
- `G4` / `AC8`: guard relaxation only allows fallback selection when guarded candidates are unavailable.
- `G5` / `AC9` / `AC10`: retries, penalties, cooldowns, and winner/loser reasons are visible in flow and report output.
- `G6` / `AC11`: the scenario matrix compares `capacity-first` against the existing strategies and key throughput metrics.
- `G7` / `AC12`: the selector stays opt-in and the default remains unchanged.
- `D1`-`D8`: canonical names, storage shape, guard toggle scope, untouched bonus, reporting detail, scenario coverage, and operator control remain aligned.

## Requirements / assumptions

- Use `capacity-first` as the canonical strategy name; keep `guarded-fit` as a draft-only shorthand.
- Keep `guardRelaxation` as a persisted boolean in rotation settings, defaulting to `false`.
- Persist `manuallyDisabled` without breaking legacy storage or settings files.
- Thread a conservative request-cost estimate from stream metadata (`options.metadata.multicodexRequestCostPercent`) through the existing activation/stream path; when the value is missing or invalid, `capacity-first` falls back to the existing safe ranking inputs without inventing a hidden request-size heuristic.
- Keep `/multicodex` as the only operator command surface.

## Implementation strategy

1. Normalize the stored data model first so settings and account state can round-trip safely.
2. Implement the selector and stream-path changes next so `capacity-first` can make the new choice without disturbing existing strategies.
3. Wire the UI and reporting surfaces after the core behavior is stable so the visible text matches the actual selection contract.
4. Finish with docs and release-note updates so the shipped behavior is discoverable and aligned.

## Execution steps

- Update the rotation and storage models, add migration-safe normalization, and extend the related unit tests.
- Add the `capacity-first` selector branch, guard-relaxation fallback, and hard-gate handling, then cover the new matrix cases in tests.
- Expose the new rotation option and disable/enable toggle in the existing controller and accounts panel, then update report text and tests.
- Revise README, ROADMAP, and CHANGELOG text to describe the resolved contract.

## Validation

- Narrow checks first: `bun test rotation-settings.test.ts account-manager.test.ts multicodex-controller.test.ts`.
- Selector and report checks next: `bun test index.test.ts report.test.ts commands.account-flow.test.ts`.
- Final repo checks: `bun run check` and `npm pack --dry-run`.
- Proof comes from command output plus targeted read-checks for the docs step.

## Risks + mitigations

- R1: Synthetic selector tests can overfit the matrix. Mitigation: keep the existing scenario comparisons and verify against `lowest-usage`.
- R2: Storage migration can regress old installs. Mitigation: add round-trip coverage and preserve optional fields/defaults.
- R3: Relaxed fallback can hide unsafe choices. Mitigation: require fit-class and fallback-class text in reports and tests.
- R4: The disable toggle can sprawl into new UX. Mitigation: keep it inside the existing accounts panel.
- R5: Request-cost input is still conservative. Mitigation: read the caller-provided metadata estimate when present and otherwise keep the existing safe ranking inputs.

## Rollout / rollback / migration

- Migration is required for storage and settings only.
- Load old files by defaulting missing `manuallyDisabled` and `guardRelaxation` values.
- Write optional fields in a backward-compatible shape so older data keeps working.
- Roll back by ignoring the new fields; the default strategy remains `lowest-usage`.

## Observability / security / privacy

N/A — no new external network surface or secret handling is introduced; reporting only reflects local rotation state and existing selection reasons.

## Execution guidance

- Keep each file group small and test it before moving on.
- Preserve existing `lowest-usage` and `stable-weekly` behavior while adding the new branch.
- Keep UI labels, report text, and tests in sync with the same IDs and terms.
- Do not widen scope to new commands or unrelated refactors.

## Open questions / blockers

None.

## Plan review handoff

Reviewer focus:

- storage and settings migration safety for `manuallyDisabled` and `guardRelaxation`
- selector correctness for hard gates, guarded fits, fallback behavior, and untouched bonuses
- report/UI wording consistency with the spec and tests
- docs updates that preserve the default strategy and the existing command surface

Pass criteria:

- every step in `plan-tasks.md` is concrete, small, and traceable to `G*`, `AC*`, and `D*`
- no hidden behavior change to the default rotation strategy
- the validation section covers the risky parts and the full repo checks

## Next steps

1. Approve this plan.
2. Implement step T1.
3. Review step T2 outputs.
4. Run the validation commands.
