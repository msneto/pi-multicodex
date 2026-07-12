# Specs

## Summary

Define the test matrix and behavior contract for the opt-in `capacity-first` rotation selector. The draft name `guarded-fit` is a shorthand only. Default rotation behavior stays unchanged.

## Problem

The current selector stack proves `lowest-usage` and `stable-weekly`, but it does not yet prove a guard-aware best-fit policy that preserves future capacity, handles stale or missing usage safely, and explains why each account won or lost.

## Goals

- G1 Validate hard gates, including reauth, manual disable, and active hard cooldown.
- G2 Validate fit against both 5h and 7d windows using request cost and guard bands.
- G3 Prefer the tightest safe fit and preserve larger pockets for later large requests.
- G4 Handle untouched, missing, and stale usage without turning them into hard filters.
- G5 Cover pressure, reset timing, retry, fallback, and reporting behavior.
- G6 Verify long-run simulations against existing strategies.
- G7 Keep the selector opt-in and keep the current default unchanged.

## Non-Goals

- Changing the default selection strategy.
- Predictive scheduling or request telemetry modeling.
- New top-level command surfaces.
- Replacing `lowest-usage` or `stable-weekly`.
- Tuning exact scoring weights beyond the required behavior contracts.

## Current Behavior

- `selection.ts` supports `lowest-usage` and `stable-weekly`.
- `preferUntouched` is a hard preference today when untouched accounts exist.
- Hard gates currently cover reauth and active quota cooldown.
- Missing usage can fall back to randomness.
- Reports explain the current strategies, but there is no `capacity-first` contract yet.
- The storage schema does not yet include a manual-disable account flag.

## Proposed Behavior

- `capacity-first` is the public strategy name.
- `guarded-fit` remains the test/draft label only.
- `capacity-first` is opt-in and does not replace `lowest-usage` as the default.
- Add a persisted `manuallyDisabled` account flag as a hard gate.
- Allow both operator control and internal automation to set or clear that flag.
- Operator control for the flag lives in the existing `/multicodex accounts` panel as a per-account toggle.
- Add a rotation setting for guard relaxation; it defaults to off.
- Guarded selection requires both windows to satisfy the post-request guard unless guard relaxation is enabled.
- Untouched accounts are a bonus, not a hard filter.
- Missing or stale usage should reduce confidence and may trigger fallback, but not auto-win.
- If no guarded candidate exists and guard relaxation is enabled, a raw-fit / risky-fit / unknown-fit fallback may be selected and must be reported as such.
- Pre-stream quota retries, authoritative cooldowns, and ambiguous penalties must remain visible in the selection flow and report output.

## Architecture / Technical Decisions

- D1: Canonical strategy name is `capacity-first`; `guarded-fit` is a spec shorthand.
- D2: Manual disable becomes a real persisted account state and hard gate; both operator control and internal automation may change it.
- D8: Operator disable/enable control lives in the existing accounts panel, not a new top-level command.
- D3: Guard relaxation is a persisted rotation toggle for `capacity-first` only, defaulting to off.
- D4: Stale and missing usage are soft penalties or fallback inputs, not hard exclusions.
- D5: Untouched preference becomes a bonus in `capacity-first` mode, not a filter.
- D6: Reports must explain the winner, losers, fit class, guard status, penalties, and fallback or retry reasons.
- D7: Long-run scenario tests must compare `capacity-first` against `lowest-usage`, `stable-weekly`, `max-bottleneck`, `random`, and `round-robin`.

## Acceptance Criteria

- AC1 Hard-gate tests pass: T001-T005.
  - reauth, manual disable, and active hard cooldown exclude accounts.
  - soft failure does not become a hard exclusion.
  - all-hard-gated input returns no selection with a clear failure reason.
- AC2 Basic fit tests pass: T010-T014.
  - choose the tightest safe fit when both accounts fit.
  - reject raw-fits that violate the 5h or 7d guard.
  - select the only fitting account when one exists.
  - return no selection when none fit.
- AC3 Best-fit preservation tests pass: T020-T022.
  - avoid wasting a large pocket on a small request.
  - use the larger pocket when the request needs it.
  - preserve one account for a later large request in a sequence.
- AC4 Window-dominance tests pass: T030-T033.
  - 5h pressure and 7d pressure each dominate when they are the real bottleneck.
  - equal-window cases still prefer the tighter safe fit.
- AC5 Pressure and reset tests pass: T040-T061.
  - weekly and burst pressure may break close ties, but neither may override safety.
  - reset timing can break near ties but cannot rescue an unsafe fit.
- AC6 Untouched tests pass: T070-T072.
  - untouched breaks true ties.
  - untouched does not override a clearly better fit.
  - untouched with missing usage stays fallback-only.
- AC7 Missing and stale usage tests pass: T080-T084.
  - missing one window uses a conservative estimate.
  - missing both windows falls back only when policy allows it.
  - stale usage can lose to fresh usage when scores are close.
  - stale usage cannot beat a much better fresh fit unless policy explicitly allows it.
- AC8 Guard-relaxation tests pass: T090-T092.
  - when enabled and no guarded candidate exists, a raw-fit fallback may be selected.
  - when disabled, no account is selected in the same setup.
  - risky fallback happens only after guarded candidates are unavailable.
- AC9 Retry tests pass: T100-T103.
  - pre-stream quota failure retries another account.
  - authoritative quota exhaustion creates hard cooldown.
  - ambiguous quota-like failure creates a soft penalty.
  - retry count respects the configured limit.
- AC10 Reporting tests pass.
  - selected-account reports include fit class, estimated cost, post-5h, post-7d, guard values, and selection reason.
  - rejected-account reports include the winning rejection reason.
  - fallback reports explain why relaxation or risky fallback was used.
  - retry reports include the failed account, failure type, penalty or cooldown, and retry count.
- AC11 Scenario tests pass: S001-S020.
  - each scenario runs under `lowest-usage`, `stable-weekly`, `capacity-first`, `max-bottleneck`, `random`, and `round-robin`.
  - compare acceptedTokens, acceptedRequests, failedRequests, preStreamFailures, retryCount, stranded5hCapacity, stranded7dCapacity, largeRequestFailureRate, accountSelectionDistribution, and guardRelaxationCount.
  - `capacity-first` must stay within 98% of `lowest-usage` acceptedTokens.
  - in variable-size and stale-data scenarios, `capacity-first` must not worsen largeRequestFailureRate or preStreamFailures versus `lowest-usage`.
  - equal-account steady-load scenarios should stay broadly similar to `lowest-usage`.
- AC12 The selector remains opt-in and the default strategy remains unchanged.

## Open Questions

- None.

## Risks

- R1 Synthetic tests may overfit the matrix and miss real-world request shapes.
- R2 Relaxed fallback can hide unsafe choices if reporting is weak.
- R3 Randomized long-run scenarios can be noisy without fixed seeds.
- R4 Adding `manuallyDisabled` requires a storage/schema update and migration-safe handling.
