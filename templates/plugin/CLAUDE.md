# __NAME__: notes for Claude

Read the root `CLAUDE.md` first, then `docs/architecture.md`. Users' view: `docs/user-guide.md`.

## What it does

__DESCRIPTION__

<!-- Replace with: the user's entry points (commands, menus, views, settings), what it reads and writes. -->

## Where to change what

<!-- One row per kind of change: the module to start in, the doc to update. Module details: docs/architecture.md. -->

| Change | Start in | Also update |
|---|---|---|
| ... | `src/core.ts` (pure) | `docs/user-guide.md` |

## Invariants (keep them)

<!-- What must never happen: data loss, renames without a check, writing outside the vault... -->

1. ...

## Tests

- `tests/core.test.ts`: unit tests (`npm test -- __ID__`).
- `tests/smoke.js`: in-app checks (`npm run smoke -- __ID__`), see `docs/testing.md`.

## Known limits / ideas not done

- ...
