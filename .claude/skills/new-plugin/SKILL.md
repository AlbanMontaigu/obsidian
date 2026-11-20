---
name: new-plugin
description: Create a new custom Obsidian plugin in this repo from a one-line idea, end to end (scaffold, code, unit + in-app smoke tests, docs), without supervision. Use when the user asks for a new Obsidian plugin or feature that doesn't belong in an existing one.
argument-hint: <id> "<what it should do>"
---

# New Obsidian plugin

Arguments: `$ARGUMENTS` (an id and/or a description; derive whichever is missing).

Follow `docs/workflow.md` section **A. New plugin**, step by step. Before writing code, read:

1. `CLAUDE.md` (root): conventions, safety, definition of done.
2. `docs/obsidian-api.md`: building blocks, internal APIs, **traps**.
3. `docs/testing.md`: how `tests/smoke.js` works (`app`, `plugin`, `check`, `sleep`, `expectError`, `fakeMenu`).
4. The closest existing plugin's `CLAUDE.md` and source for patterns to reuse.

Then:

- `npm run status` to check the id is free; `npm run new -- <id> --name "<Name>" --description "<one sentence>"`.
- `npm run smoke -- <id>` on the untouched scaffold: must PASS (proves the toolchain).
- Pure logic in `src/<topic>.ts` + `tests/<topic>.test.ts`; Obsidian wiring in `src/main.ts` and small UI modules.
- A fixture vault in `tests/fixtures/vault/` if the plugin works on files; a `tests/smoke.js` that drives every
  user-facing entry point (commands, menus, views, settings) and ends with the main UI open.
- Loop `npm run typecheck`, `npm test -- <id>`, `npm run smoke -- <id>` until green; **Read
  `dist/<id>-smoke.png`** and fix what looks wrong.
- Write `plugins/<id>/README.md` (user) and `plugins/<id>/CLAUDE.md` (spec, architecture, invariants, tests,
  limits; same outline as `plugins/tag-everything/CLAUDE.md`). Add the plugin to the root `CLAUDE.md` table and
  the root `README.md` list.

Do **not** deploy into a real vault. Finish with a report: what the plugin does, decisions you made on open points,
what ran (typecheck / unit / smoke with counts), the screenshot path, and the deploy command for the owner.
