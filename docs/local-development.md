# Local development

## Tooling

- Package manager: `bun`
- Tool version manager: `mise`
- Git hooks: `lefthook`
- Node engine: `>=24.14.0`

## Setup

```bash
mise install
bun install
lefthook install
```

## Daily workflow

```bash
bun run lint
bun run tsgo
bun run test
bun run check
bun run context-check
```

Target a single test file when you are working on one area:

```bash
bun test rotation-settings.test.ts
bun test account-manager.test.ts
bun test index.test.ts
```

## Run the extension locally

```bash
pi -e ./index.ts
```

## Packaging and release checks

```bash
npm pack --dry-run
bun run pack:dry
bun run release:dry
```

## Generated schema

If storage or schema shapes change, regenerate the schema before review:

```bash
bun run generate:schema
```

## Notes

- `bun run check` is the standard validation command for local changes.
- `bun run context-check` validates docs, links, and skill wiring.
- `npm pack --dry-run` checks the package contents that will ship.
- `bun run release:dry` is the release rehearsal before publishing.
- Use the docs front door at `docs/README.md` when you need architecture or workflow context.
