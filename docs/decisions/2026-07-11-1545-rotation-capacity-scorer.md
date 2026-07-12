# Rotation selector: throughput-first capacity scorer

Date: 2026-07-11 15:45

## Summary

The current rotation system is good at picking a *reasonable* account, but it is not designed to maximize total usable tokens across multiple accounts. It primarily optimizes for low reported usage, not for future throughput. That is fine for a simple and stable heuristic, but it leaves room for a stronger policy when the goal is to use the full pool of accounts as efficiently as possible.

This report explains the current problem, compares the available approaches, proposes a capacity-first selector, and outlines how I would implement it.

## 1. The problem

MultiCodex currently rotates among eligible accounts using usage snapshots from two windows:

- **5h window** (`primary`)
- **7d window** (`secondary`)

The present selector is already careful:

- it ignores exhausted or re-auth-required accounts
- it prefers untouched accounts when configured to do so
- it retries pre-stream quota failures up to a configurable limit
- it falls back to another account when auth validation fails
- it can smooth weekly burn with `stable-weekly`

That said, the current logic is still heuristic-based. It does **not** model actual token throughput. In practice, this means:

1. It ranks by usage percentages, not by remaining usable capacity.
2. It does not estimate request cost.
3. It cannot distinguish between “low usage but fragile” and “slightly higher usage but much more usable.”
4. It may prefer smoother distribution over actual utilization.
5. When usage is missing, it may fall back to randomness.

So the key issue is not that the selector is bad. The issue is that it answers a different question than the one you care about:

- current question: “Which account looks least used?”
- desired question: “Which account is most likely to absorb the next request safely while preserving total pool capacity?”

## 2. What the code does today

The main selection path is split across a few places:

- `selection.ts` decides the winning account.
- `account-manager.ts` applies the choice, refreshes tokens, and handles quota exhaustion.
- `stream-wrapper.ts` retries on pre-stream quota failure.
- `rotation-settings.ts` stores selection strategy and related knobs.
- `report.ts` explains why a choice won or lost.

### Current low-usage rule

`lowest-usage` is effectively:

- score each account by `max(5h used%, 7d used%)`
- choose the smallest score
- tiebreak by earlier weekly reset
- tiebreak again by input order

This is simple and safe. It avoids obviously hot accounts. But it is still a proxy, not a throughput model.

### Current stable-weekly rule

`stable-weekly` tries to distribute weekly burn more evenly. It:

- computes a tier from remaining 5h capacity
- scores accounts using weekly remaining fraction minus a time-to-reset term
- only considers accounts with weekly quota left
- falls back to random if no weekly-quota candidate exists

This is useful if your goal is to smooth usage across the week. It is not a raw maximization policy.

### Current untouched preference

`preferUntouched` is a hard preference today: untouched accounts are filtered first when any are available. That can be useful for preserving fresh accounts, but it also means the selector may ignore a warmer account that is actually a better throughput candidate.

## 3. Why the current approach is not enough for maximum throughput

### 3.1 Percentages are not capacity

Percent used is a coarse signal. Two accounts can both show “40% used” while having very different remaining utility depending on recent burst behavior, reset timing, and how much of each window is actually constraining future work.

### 3.2 The bottleneck matters more than the average

For throughput, the important quantity is not the average of both windows. It is the bottleneck:

- if one window is near exhaustion, that account is fragile
- if both windows have room, the account is useful
- if the windows are imbalanced, the account may be risky even when its average looks fine

### 3.3 Smoothness is not maximization

`stable-weekly` deliberately spreads usage. That is a valid policy, but it can reduce short-term throughput by avoiding the account that is best able to absorb the next request.

### 3.4 Random fallback hides lost opportunity

If ranking data is missing or the weekly quota filter removes every candidate, the system may fall back to randomness. That is acceptable as a safety net, but not ideal as a strategy for maximizing token usage.

### 3.5 No request-size model

The selector does not know whether the next request is small or large. Without request-size telemetry, the best possible policy is still heuristic. That means the right goal is not “perfect optimization”; it is “better risk-adjusted selection than today.”

## 4. Possible solutions

### Option A: Keep the current strategies only

**Pros**
- zero new complexity
- already well understood
- stable and deterministic

**Cons**
- still heuristic-only
- not aimed at throughput maximization
- may leave capacity unused

### Option B: Tune `lowest-usage`

Possible improvements:

- improve tie-breakers
- make untouched preference softer
- reduce random fallback
- add better reporting

**Pros**
- small change surface
- easy to reason about
- preserves the current mental model

**Cons**
- still ranks by proxy usage
- still not a real capacity model
- only incremental improvement

### Option C: Add a new `capacity-first` strategy

This strategy would rank by remaining bottleneck headroom and then subtract risk penalties.

**Pros**
- directly aligned with throughput
- can preserve the current defaults
- explicit and opt-in
- easier to explain than hidden heuristics

**Cons**
- more logic
- still heuristic without burn telemetry
- needs tests and documentation

### Option D: Add predictive scheduling

Use historical request cost and recent success/failure patterns to estimate expected next-token burn.

**Pros**
- best theoretical throughput
- can adapt to usage patterns

**Cons**
- significantly more complex
- requires telemetry and modeling
- harder to validate and maintain

## 5. My proposal

I would add a **new opt-in strategy** called `capacity-first` and keep `lowest-usage` as the default.

That gives us:

- backward compatibility
- a clear throughput-oriented mode
- a safe way to evaluate whether the strategy is better in practice

### 5.1 Core principle

Score each eligible account by its **safe remaining headroom**, not by raw usage.

The bottleneck is:

- `r5 = 100 - primary.usedPercent`
- `r7 = 100 - secondary.usedPercent`
- `capacity = min(r5, r7)`

That is the basic throughput signal.

### 5.2 Risk penalties

After the base capacity score, subtract penalties for risk:

- **missing usage data**
  - lower confidence, lower score
- **window asymmetry**
  - an account with one hot window and one cool window is less stable
- **recent quota exhaustion**
  - recently blocked accounts should not be preferred too soon
- **manual or auth constraints**
  - these remain hard gates, not soft penalties

### 5.3 Untouched accounts should not be a hard filter in capacity-first mode

For maximum throughput, untouched should be a **bonus**, not a filter.

Reason:

- hard filtering can discard a better warm candidate
- capacity-first is about ranking all eligible accounts
- untouched accounts can still be preferred through a small bonus or a tie-break

### 5.4 Proposed score shape

A practical first version could be:

```ts
score =
  min(100 - primary.usedPercent, 100 - secondary.usedPercent)
  - asymmetryPenalty
  - unknownUsagePenalty
  - cooldownPenalty
  + untouchedBonus
```

Suggested meaning:

- `asymmetryPenalty`: scales with the difference between the two windows
- `unknownUsagePenalty`: applies when one or both windows are missing
- `cooldownPenalty`: huge penalty if quota exhaustion is recent or still active
- `untouchedBonus`: small bonus, not a gate

### 5.5 Tie-break order

If scores are equal, use:

1. higher bottleneck headroom
2. earlier reset for the bottleneck window
3. smaller asymmetry
4. stable input order

### 5.6 Why this is better

This policy is closer to what you want because it asks:

- how much capacity is still safe to use?
- which account is most likely to survive another request?
- which choice preserves the rest of the pool?

That is more aligned with throughput than “lowest observed usage.”

## 6. Justification

### 6.1 Why bottleneck headroom is the right base

The usable capacity of an account is limited by the stricter window. If one window is nearly full, the account is near failure even if the other window looks healthy.

### 6.2 Why asymmetry matters

A balanced account is generally safer than a lopsided one. The penalty prevents choosing accounts that look good on one axis but are structurally fragile.

### 6.3 Why untouched should be a bonus

Untouched accounts are valuable, but the throughput goal is served better by ranking all eligible candidates rather than excluding touched ones.

### 6.4 Why default should remain `lowest-usage`

`lowest-usage` is simpler, familiar, and already behaves well enough for most users. Changing the default would be a behavior risk without enough evidence that the new policy is universally better.

### 6.5 Why not jump straight to predictive scheduling

Predictive scheduling would be the best long-term solution, but it is too big a leap right now. The codebase needs a reversible, low-risk step first.

## 7. How I would implement it

### 7.1 Data model

Add a new strategy value in `rotation-settings.ts`:

- `lowest-usage`
- `stable-weekly`
- `capacity-first`

Keep normalization backward compatible.

### 7.2 Selector changes

In `selection.ts`:

- add a capacity-first candidate type
- compute base headroom from both windows
- add penalties and bonuses
- compare candidates by score
- keep current hard gates for:
  - reauth required
  - active cooldown
  - manual override logic outside selector

### 7.3 Reporting changes

Update `report.ts` so the rotation report explains:

- base headroom
- penalties applied
- final score
- why the account won or lost

This is important because the strategy will only be useful if users can inspect it.

### 7.4 UI and settings

Update `/multicodex rotation` so users can choose:

- `lowest-usage`
- `stable-weekly`
- `capacity-first`

The description should make the trade-off explicit:

- `lowest-usage`: simplest, conservative
- `stable-weekly`: smooth weekly burn
- `capacity-first`: maximize usable headroom

### 7.5 Tests

Add tests for:

- balanced vs asymmetrical windows
- untouched bonus not overriding a clearly better candidate
- missing usage data penalty
- recent cooldown penalty
- ties on equal capacity
- behavior with `preferUntouched` on and off

### 7.6 Rollout

Keep the current default and release the new strategy as opt-in first.

That way we can verify whether it actually improves throughput before making any broader behavior changes.

## 8. Recommendation

My recommendation is:

- **keep `lowest-usage` as the default**
- **add `capacity-first` as an opt-in strategy**
- **soften untouched preference in the new mode**
- **keep `stable-weekly` for users who want smoother depletion**

That gives the project three clear intents:

- conserve and simplify
- smooth and distribute
- maximize throughput

## 9. Conclusion

The current rotation algorithm is good, but it is a heuristic, not a maximizer. If the real goal is to use the full pool of accounts as efficiently as possible, the system needs a capacity-first ranker that looks at bottleneck headroom and penalizes risk.

The safest path is not to replace the existing behavior. The safest path is to add a new strategy, prove it with tests, and let users opt into the throughput-oriented mode when they want it.
