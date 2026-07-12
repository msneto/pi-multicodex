# Implementation checklist

## step_id

T1

goal

Persist `capacity-first`, `guardRelaxation`, and `manuallyDisabled` in the shared data models with backward-compatible normalization.

status

done

verification

`bun test rotation-settings.test.ts storage.test.ts account-manager.test.ts`

result

Passed; rotation settings, storage migration, and account loading round-trip the new fields.

notes


## step_id

T2

goal

Implement the `capacity-first` selector branch, hard gates, guard relaxation fallback, and request-cost threading through the activation path.

status

done

verification

`bun test index.test.ts`

result

Passed; selector logic now covers capacity-first, manual disable gates, and request-cost threading.

notes


## step_id

T3

goal

Expose the new rotation option and disable/enable toggle in the existing controller and accounts panel, then update report text and tests.

status

done

verification

`bun test report.test.ts multicodex-controller.test.ts commands.account-flow.test.ts`

result

Passed; controller settings, account-panel disable/enable, and report output all reflect the new capacity-first contract.

notes


## step_id

T4

goal

Update README, ROADMAP, and CHANGELOG text to describe the resolved rotation contract.

status

done

verification

`read-check the edited docs for 'capacity-first', 'guardRelaxation', and 'manuallyDisabled'`

result

Passed; README, ROADMAP, and CHANGELOG each mention the new rotation contract and manual-disable state.

notes

