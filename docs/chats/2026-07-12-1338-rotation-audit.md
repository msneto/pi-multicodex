# Rotation selector audit

## Verdict

partial pass

## Summary

The opt-in `capacity-first` path is implemented and stable defaults still work. It is not a full guarded-fit selector yet: the code is percentage-only, has no explicit guard bands, and its report output cannot explain the real request-cost used at selection time.

## Critical findings

- No explicit guard-band model. “Guarded” only means `remainingAfterRequest >= 0` for both windows.
- Report output is not request-aware. Capacity-first analysis is computed with request cost `0`.
- Ranking is percentage-only. There is no absolute quota or limit model.
- Ambiguous quota-like failures are not modeled separately; they become a hard cooldown path.

## Recommended next fixes

1. Make report output honest when no request-cost context is available.
2. Add a real guard-band model before describing this as guarded-fit.
3. Decide whether quota-like failures should be soft-penalized or hard-gated.

## Test results

- `bun run check`
- `npm pack --dry-run`

## Final recommendation

Safe to keep as an opt-in capacity heuristic. Not yet safe to describe as a full guarded-fit selector.
