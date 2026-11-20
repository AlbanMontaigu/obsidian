# __NAME__: notes for Claude

Read the root `CLAUDE.md` first. User-facing description: `README.md`.

## What it does

__DESCRIPTION__

<!-- Replace with: the user's entry points (commands, menus, views, settings), what it reads and writes. -->

## Architecture

| File | Role |
|---|---|
| `src/main.ts` | Plugin wiring: commands, settings tab, events. |
| `src/core.ts` | **Pure** logic, unit-tested, no `obsidian` import. |

## Invariants (keep them)

<!-- What must never happen: data loss, renames without a check, writing outside the vault... -->

1. ...

## Tests

- `tests/core.test.ts`: unit tests (`npm test -- __ID__`).
- `tests/smoke.js`: in-app checks (`npm run smoke -- __ID__`), see `docs/testing.md`.

## Known limits / ideas not done

- ...
