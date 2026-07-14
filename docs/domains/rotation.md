# Rotation contract

This document describes the current MultiCodex account rotation behavior.

## Scope

Rotation decides which managed account should handle the next Codex request. It does not change the default strategy, and it does not add new command surfaces.

## Strategies

`rotation-settings.ts` supports these selection strategies:

- `lowest-usage` — default
- `stable-weekly`
- `capacity-first` — opt-in

`lowest-usage` remains the default. `stable-weekly` and `capacity-first` are explicit opt-ins.

## Shared hard gates

Rotation excludes accounts that are:

- marked `needsReauth`
- on active quota cooldown (`quotaExhaustedUntil > now`)
- marked `manuallyDisabled`

These are hard gates. They do not depend on the active strategy.

## `lowest-usage`

`lowest-usage` remains the conservative default.

Selection order:

1. Prefer untouched accounts when `preferUntouched` is on and untouched candidates exist.
2. Otherwise, rank by lowest max used percent across the 5h and 7d windows.
3. Tie-break by earlier weekly reset.
4. Tie-break by input order.

If no usage-backed account exists, rotation falls back to a random available account.

## `stable-weekly`

`stable-weekly` smooths weekly burn.

It:

- only considers accounts with weekly quota left
- scores accounts by weekly remaining fraction minus a time-to-reset term
- still honors `preferUntouched` as a preference, not a gate
- falls back to random when no weekly-quota candidate exists

## `capacity-first`

`capacity-first` is the throughput-oriented strategy.

### Inputs

It analyzes both usage windows for each eligible account:

- 5h / `primary`
- 7d / `secondary`

It also reads a conservative request-cost estimate from stream metadata when available:

- `options.metadata.multicodexRequestCostPercent`

If the estimate is missing, invalid, negative, or above 100, the selector treats it as unavailable and the report summarizes the request cost as assuming `0%`.

### Fit classes

`capacity-first` classifies each account as one of:

- `guarded-fit`
- `raw-fit`
- `risky-fit`
- `unknown-fit`

The guard band is currently `5%` per window.

### Ranking behavior

`capacity-first` prefers:

1. guarded fits
2. then raw fits only when guard relaxation is enabled
3. then risky or unknown fallbacks only when guard relaxation is enabled

Within a fit class, it prefers tighter safe fits and then uses tie-breaks that favor:

- more known usage
- smaller bottleneck distance
- smaller asymmetry
- fresher usage
- untouched accounts
- earlier input order

### Untouched and stale usage

In `capacity-first`, untouched accounts are a bonus, not a filter.

Missing or stale usage lowers confidence, but it does not become a hard exclusion by itself. An eligible account can still win if it is the best available fit.

### Guard relaxation

`guardRelaxation` is a persisted rotation setting for `capacity-first` only.

- `false` (default): return no account when no guarded fit exists
- `true`: allow relaxed fallback selection when no guarded fit exists

## Reporting

`report.ts` explains rotation decisions using the active strategy.

For `capacity-first`, reports include:

- fit class
- guard band
- request-cost estimate
- post-request window state
- post-guard window state
- missing-usage or stale-usage penalties
- the reason an account won or lost

Reports also label:

- active accounts
- manual overrides
- disabled accounts
- quota cooldowns
- untouched usage

## Operational notes

- Rotation settings live in `settings.json` under `pi-multicodex`.
- `manuallyDisabled` is stored with managed account state under `~/.pi/agent/codex-accounts.json`.
- The command surface for inspecting or changing rotation remains under `/multicodex`.
- The selection contract is documented here, while `README.md` remains the user-facing overview.
