# CLAUDE.md

Guidance for Claude Code in this repo. Read this first, then the `CLAUDE.md` of the plugin you touch.

## What this repo is

The owner's **custom Obsidian plugins**, one folder per plugin under `plugins/<id>/`, sharing one toolchain
(TypeScript + esbuild, `tools/*.mjs`). Personal tools, desktop only (Windows), never published to the
community catalogue. Its own git repo (the workspace root is not one), branch `main`, remote `origin` =
<https://github.com/AlbanMontaigu/obsidian.git>; commit or push only when asked. `dist/` and `backups/` are generated
and git-ignored.

| Plugin | What it is | Spec |
|---|---|---|
| `tag-everything` | **TagEverything**: tag any file or folder from the file explorer; notes in their frontmatter, other files in the file name (`report[tax receipt].pdf`) or in `.ts` sidecars; tag panel, explorer badges | `plugins/tag-everything/CLAUDE.md` |

## You can work autonomously here

Everything needed to create, change and verify a plugin **without the owner** is in this repo:

- `docs/workflow.md`: the step-by-step playbooks (**new plugin**, **improve a plugin**, **code review**).
- `docs/code-style.md`: how code is written here (KISS, DRY, comments, errors) and the review checklist.
- `docs/README.md`: the documentation map: which doc holds what, and **which doc to update when**.
- `docs/obsidian-api.md`: the Obsidian API notes that matter, internal APIs we rely on, and the traps already hit.
- `docs/testing.md`: unit tests (`node --test`) and the **in-app smoke test** (`npm run smoke`), which runs the plugin
  in a real, throwaway Obsidian and gives you pass/fail, console errors and a screenshot you can look at.
- `node_modules/obsidian/obsidian.d.ts`: the full typed API with doc comments. Grep it before guessing a signature.
- Skills: `/new-plugin <id> "<what it does>"`, `/improve-plugin <id> "<change>"`.

**Ask the owner only** for: deploying into a real vault (see *Safety*), product decisions the request leaves open
(e.g. where data is stored), or anything outside this folder.

## Commands

```powershell
npm install                                  # once
npm run status                               # per plugin: source / built / installed version, current, enabled
npm run new -- <id> --name "Name" --description "One sentence."
npm run typecheck                            # tsc over every plugin
npm test -- <id>                             # unit tests (node --test, plugins/<id>/tests/*.test.ts)
npm run smoke -- <id>                        # build + load in a throwaway Obsidian + tests/smoke.js + screenshot
npm run build -- <id>                        # typecheck + bundle into dist/<id>/
npm run deploy -- <id> [--vault <path|name>] # into a REAL vault: ask first
npm run dev -- <id>                          # watch + deploy on save (owner's interactive use)
npm run undeploy -- <id>
```

Then **look at** `dist/<id>-smoke.png` with the Read tool: it is the app as `tests/smoke.js` left it.

## Definition of done (every change)

1. `npm run typecheck` clean.
2. `npm test -- <id>` passes; pure logic you added has a test.
3. `npm run smoke -- <id>` prints `PASS` with no unexpected console error; you looked at the screenshot.
4. A smoke `check()` covers the new behaviour (a new command, menu item, view, setting...).
5. The docs describe the change (`docs/README.md` → *When to update what*): the plugin's `docs/user-guide.md`
   for what users see, `docs/architecture.md` for modules and flows, `CLAUDE.md` for invariants, tests, limits;
   `manifest.json` `version` bumped (patch for fixes, minor for features).
6. Report to the owner: what changed, what ran (with results), what did not, what to do in Obsidian.

## Safety

- **Never write into the owner's vaults** without being asked: `npm run deploy`, `dev`, `undeploy` and
  `tools/*` scripts that take a vault all count. Default vault = the one Obsidian has open
  (`C:\Users\a151062\OneDrive - Worldline\1. PARA`, ~9 500 files on OneDrive, real work documents). A second vault
  `Perso` exists. Read-only checks on a vault (like `plugins/tag-everything/tools/check-vault.ts`) are fine.
- `npm run smoke` is always safe: own profile (`--user-data-dir`) and own vault in `%TEMP%`, deleted after;
  it only kills Obsidian processes started with its own debugging port. It runs fine while the owner's
  Obsidian is open.
- A plugin that renames, moves or deletes files must refuse rather than guess (name clash, invalid name,
  unreadable metadata), and never overwrite a file it could not parse.

## Conventions

- **Layout per plugin**: `manifest.json` (id = folder name, no "obsidian" in it), `src/main.ts` (default export
  extends `Plugin`), pure logic in modules that do **not** import `obsidian` (so `node --test` can run them),
  `styles.css`, `tests/*.test.ts`, `tests/smoke.js`, optional `tests/fixtures/vault/`, `README.md`, `CLAUDE.md`,
  `docs/user-guide.md`, `docs/architecture.md`.
- **Code style** (`docs/code-style.md`): KISS, no abstraction before a second caller; extract real duplication
  into the module that owns the topic; refactor only when it removes duplication, dead code or a misleading name;
  files by topic (~500 lines max); doc comments on exports, *why* comments only, no commented-out code.
- **No per-plugin `package.json`** and no new dependency without a reason; prefer the Obsidian API and the DOM.
  A runtime npm dependency gets bundled by esbuild: add it to the root `package.json`.
- **Imports between source files end in `.ts`** (`./format.ts`): esbuild and `node --test` both resolve it.
- **Styles**: Obsidian CSS variables only (`--text-normal`, `--interactive-accent`, `--background-modifier-border`,
  `--radius-s`, `--font-ui-small`...), every class prefixed with the plugin id (`.tag-everything-chip`).
- **Fail gracefully**: `try/catch` around vault I/O, internal APIs and DOM tweaks; log with a `[<id>]` prefix via
  `console.warn` / `console.error` (never `console.log` for errors); one failing item never stops a batch;
  tell the user with a `Notice`.
- **Register everything** (`registerEvent`, `registerDomEvent`, `register(() => cleanup)`, `addCommand`) so disabling
  the plugin leaves nothing behind.
- **Names**: no third-party brand in a plugin id, name, UI string or manifest. Mentioning compatibility with
  another app in docs is fine.
- **Docs**: Mermaid only for diagrams; one fact in one place (link, don't copy); docs change in the same commit as
  the code.

## Environment

Windows 11, PowerShell + Git Bash. Node 22+ (`node --test` runs `.ts` directly). Obsidian installed per-user at
`%LOCALAPPDATA%\Programs\obsidian` (1.15 at the time of writing; override with `OBSIDIAN_EXE`). The `obsidian` npm
package (types only) can lag the app: an API in the app but missing from the types needs a narrow cast, see
`docs/obsidian-api.md`. Paths contain spaces and live on OneDrive: quote them; `[`/`]` in PowerShell paths need
`-LiteralPath`.
