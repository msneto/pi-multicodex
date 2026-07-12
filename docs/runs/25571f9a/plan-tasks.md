# Plan tasks

## step_id

T1

goal

Persist `capacity-first`, `guardRelaxation`, and `manuallyDisabled` in the shared data models with backward-compatible normalization.

files

- `/home/msneto/github/pi-multicodex/rotation-settings.ts`
- `/home/msneto/github/pi-multicodex/storage.ts`
- `/home/msneto/github/pi-multicodex/schemas/codex-accounts.schema.json`
- `/home/msneto/github/pi-multicodex/account-manager.ts`
- `/home/msneto/github/pi-multicodex/rotation-settings.test.ts`
- `/home/msneto/github/pi-multicodex/account-manager.test.ts`

interfaces_contracts

- `SelectionStrategy` includes `capacity-first`.
- `RotationSettings` includes a boolean `guardRelaxation` field that defaults to `false`.
- `Account` includes an optional `manuallyDisabled` field.
- Loaders normalize legacy records without losing existing fields.
- Saves remain backward compatible for older storage files.

change

Extend the storage and settings models, add migration-safe normalization for the new fields, and update the tests that prove defaults and round-trips.

cwd

`/home/msneto/github/pi-multicodex`

env_preconditions

`N/A — local repo files only`

check_type

command

check

`bun test rotation-settings.test.ts account-manager.test.ts`

expected_result

Passes; the new fields round-trip cleanly and the old defaults still load unchanged.

done_proof

Test output plus a read-check showing the new fields are optional and defaulted.

depends_on

None.

unlocks

T2, T3

stop

Stop if the migration changes current defaults or drops existing account data.

independent_review / merge_safety

Independent review should verify the schema and loader compatibility against existing files. Merge safety is high once the normalization tests pass.

## step_id

T2

goal

Implement the `capacity-first` selector branch, hard gates, guard relaxation fallback, and request-cost threading through the activation path.

files

- `/home/msneto/github/pi-multicodex/selection.ts`
- `/home/msneto/github/pi-multicodex/stream-wrapper.ts`
- `/home/msneto/github/pi-multicodex/account-manager.ts`
- `/home/msneto/github/pi-multicodex/index.test.ts`

interfaces_contracts

- `pickBestAccount(...)` and `activateBestAccount(...)` accept `requestCostEstimatePercent?: number`, sourced from `SimpleStreamOptions.metadata.multicodexRequestCostPercent` when present.
- Hard gates exclude `needsReauth`, `quotaExhaustedUntil`, and `manuallyDisabled` accounts.
- `capacity-first` uses guarded fit by default and only relaxes guards when the rotation setting allows it.
- Untouched accounts act as a bonus, not a filter.
- Missing or stale usage lowers confidence but stays in the soft-penalty path.
- A missing, invalid, or negative request-cost estimate is treated as `undefined`, so the selector keeps the existing safe ranking inputs and does not invent a hidden request-size heuristic.

change

Add the new ranking branch, preserve the existing `lowest-usage` and `stable-weekly` behavior, and thread the selector inputs from the stream path so the new branch can score the next request conservatively.

cwd

`/home/msneto/github/pi-multicodex`

env_preconditions

`N/A — local repo files only`

check_type

command

check

`bun test index.test.ts`

expected_result

Passes; the new `capacity-first` cases pick the expected winner, and the existing strategies still behave the same.

done_proof

Test output showing the new branch and unchanged default strategies.

depends_on

T1

unlocks

T3

stop

Stop if any existing strategy regresses or an unsafe fit can still win without relaxation.

independent_review / merge_safety

Independent review should compare the selector trace against `AC1`-`AC8`. Merge safety is medium risk because the stream selection path is behavior-critical.

## step_id

T3

goal

Expose the new rotation option and disable/enable toggle in the existing controller and accounts panel, then update report text and tests.

files

- `/home/msneto/github/pi-multicodex/multicodex-controller.ts`
- `/home/msneto/github/pi-multicodex/account-flows.ts`
- `/home/msneto/github/pi-multicodex/account-manager.ts`
- `/home/msneto/github/pi-multicodex/report.ts`
- `/home/msneto/github/pi-multicodex/multicodex-controller.test.ts`
- `/home/msneto/github/pi-multicodex/account-manager.test.ts`
- `/home/msneto/github/pi-multicodex/commands.account-flow.test.ts`
- `/home/msneto/github/pi-multicodex/report.test.ts`

interfaces_contracts

- The rotation panel offers `capacity-first` and the guard-relaxation toggle.
- The accounts panel can mark and clear `manuallyDisabled` for the selected account.
- Disabling the currently manual account clears the manual pin immediately; if it was also active, the caller rotates to a replacement account in the same action.
- Reports include fit class, guard state, penalties, fallback class, retry reasons, and disabled tags.
- Visible labels and actions must stay aligned with the selector behavior.

change

Update the controller settings UI, add the account-panel disable toggle, wire the disable/enable state transitions through the account manager, and expand the report formatting so the user-facing text matches the new selector contract.

cwd

`/home/msneto/github/pi-multicodex`

env_preconditions

`N/A — local repo files only`

check_type

command

check

`bun test report.test.ts multicodex-controller.test.ts commands.account-flow.test.ts`

expected_result

Passes; the new UI and report text reflect the same state and selection reasons as the selector.

done_proof

Test output plus a read-check of the rendered labels and tags.

depends_on

T1, T2

unlocks

T4

stop

Stop if the panel actions become ambiguous or the report text no longer matches the selector behavior.

independent_review / merge_safety

Independent review should verify the UX strings and state transitions against the spec IDs. Merge safety is good once the model and selector tests already pass.

## step_id

T4

goal

Update README, ROADMAP, and CHANGELOG text to describe the resolved rotation contract.

files

- `/home/msneto/github/pi-multicodex/README.md`
- `/home/msneto/github/pi-multicodex/ROADMAP.md`
- `/home/msneto/github/pi-multicodex/CHANGELOG.md`

interfaces_contracts

- The docs describe `capacity-first` as opt-in.
- The docs keep `lowest-usage` as the default.
- The docs mention the accounts-panel toggle and the guarded-fit fallback contract.

change

Revise the rotation overview, roadmap status, and unreleased notes so they match the implemented behavior and do not promise any extra scope.

cwd

`/home/msneto/github/pi-multicodex`

env_preconditions

`N/A — local repo files only`

check_type

read-check

check

`read-check the edited docs for \'capacity-first\', \'guardRelaxation\', and \'manuallyDisabled\'`

expected_result

Passes; the edited docs reflect the same contract as the code and tests.

done_proof

Read-check output showing the expected terms in the edited docs.

depends_on

T1, T2, T3

unlocks

T5

stop

Stop if any doc drifts from the code contract or restores deprecated defaults.

independent_review / merge_safety

Independent review should confirm the docs stay inside spec scope. Merge safety is low risk because this step is documentation-only.

## step_id

T5

goal

Run final repo validation for the rotation-selector change set.

files

- `/home/msneto/github/pi-multicodex` (all modified files)

interfaces_contracts

- Validation covers unit tests, the repo-wide check, and package contents.
- The final pass proves the change set is ready for plan review handoff.

change

Execute the narrow tests first, then the repo-wide checks and dry-run packaging.

cwd

`/home/msneto/github/pi-multicodex`

env_preconditions

`N/A — local repo files only`

check_type

command

check

`bun run check && npm pack --dry-run`

expected_result

Passes; lint, typecheck, tests, and tarball contents all succeed.

done_proof

Command output with zero failures.

depends_on

T1, T2, T3, T4

unlocks

None.

stop

Stop if any validation step fails; fix the smallest failing step before retrying.

independent_review / merge_safety

Independent review should inspect failures by file group, not by whole repo. Merge safety is only acceptable after all prior steps and validations pass.
