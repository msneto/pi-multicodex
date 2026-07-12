# Rotation selector audit

## Verdict

historical partial pass

## Summary

This audit captures the state of `capacity-first` before the request-cost contract and manual-disable precedence were fully documented. At that point, the opt-in path existed and stable defaults still worked, but the report still lacked request-cost context and the selector was not yet described as a full guarded-fit model.

For current behavior, use the resolved docs in `README.md` and `docs/runs/25571f9a/*`.

## Critical findings

- No explicit guard-band model at the time of this audit. “Guarded” only meant `remainingAfterRequest >= 0` for both windows.
- Report output was not request-aware then. Capacity-first analysis was computed with request cost `0`.
- Ranking was percentage-only. There was no absolute quota or limit model in the audit write-up.
- Ambiguous quota-like failures were not modeled separately and fell into a hard cooldown path.

## Recommended next fixes

1. Make report output honest when no request-cost context is available.
2. Add a real guard-band model before describing this as guarded-fit.
3. Decide whether quota-like failures should be soft-penalized or hard-gated.

These notes are preserved for audit history; the current plan/docs now cover the request-cost and manual-disable contracts.

## Test results

- `bun run check`
- `npm pack --dry-run`

## Final recommendation

Safe to keep as an opt-in capacity heuristic. Not yet safe to describe as a full guarded-fit selector.
