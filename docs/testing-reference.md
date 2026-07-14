# Testing reference

## Test layout

- Root tests live at the repository root.
- Vitest is configured for Node and includes `*.test.ts` files from the repo root.
- Scenario-style coverage also lives in root `*.test.ts` files, such as `capacity-first.scenario.test.ts`.

## Common test lanes

```bash
bun test rotation-settings.test.ts
bun test account-manager.test.ts
bun test index.test.ts
bun test report.test.ts
bun test commands.account-flow.test.ts
bun test multicodex-controller.test.ts
bun test capacity-first.scenario.test.ts
```

Use the narrowest file set that covers the code you changed.

## Change-type guidance

- Storage or settings changes: start with `rotation-settings.test.ts`, `account-manager.test.ts`, and `storage.test.ts`.
- Selection changes: start with `index.test.ts` and `capacity-first.scenario.test.ts`.
- Controller or UI flow changes: start with `multicodex-controller.test.ts`, `commands.account-flow.test.ts`, and `report.test.ts`.
- Session or hook changes: start with `hooks.test.ts`, `refresh-race.test.ts`, or `status.test.ts` when relevant.
- Packaging or docs routing changes: run `bun run check` and `npm pack --dry-run` after the targeted tests.

## Validation order

1. Run the smallest relevant test file.
2. Expand to related tests.
3. Run `bun run check`.
4. Run `npm pack --dry-run` if the change affects shipped files or docs.

## Notes

- `bun run test` runs the whole Vitest suite.
- `bun run check` is the standard repo validation lane.
- Keep new tests close to the module they cover.
