---
name: improve-plugin
description: Fix a bug or add a feature to an existing Obsidian plugin in this repo, with a test that proves it, and verify it in a throwaway Obsidian. Use when the user asks to change, fix or extend a plugin under plugins/.
argument-hint: <id> "<change or bug>"
---

# Improve an Obsidian plugin

Arguments: `$ARGUMENTS`. If no id is given, pick the plugin from the request (`npm run status` lists them).

Follow `docs/workflow.md` section **B. Improve an existing plugin**:

1. Read `CLAUDE.md` (root), then `plugins/<id>/CLAUDE.md` (where to change what, **invariants**) and
   `plugins/<id>/docs/architecture.md` (flows, module reference), then the source
   files it points to. Skim `docs/obsidian-api.md` → *Traps*.
2. Baseline: `npm test -- <id>` (no smoke yet). If red before your change, report it and fix it first. Follow the
   **test budget** (`docs/testing.md`): targeted tests while working, mutation-check each new test, smoke once at
   the end.
3. Bug: reproduce it as a failing unit test (pure logic) or smoke `check()` (wiring / UI) **before** fixing.
   Feature: write the tests with the code. Keep every invariant; a stored-format change must stay readable by the
   previous version.
4. Definition of done (root `CLAUDE.md`): typecheck clean, unit + smoke green, screenshot **looked at**
   (`dist/<id>-smoke.png`), new behaviour covered by a `check()`, docs updated (`docs/README.md` → *When to update what*: user guide,
   architecture, `CLAUDE.md`), code following `docs/code-style.md`, `manifest.json`
   version bumped (patch = fix, minor = feature).
5. If the change touches how file names or stored data are written, also run the plugin's read-only vault checks
   (e.g. `node plugins/tag-everything/tools/check-vault.ts "<vault>"`), which never write.

Do **not** deploy into a real vault unless asked. Report: what changed and why, what ran with results, what did not
run, and the deploy command.
