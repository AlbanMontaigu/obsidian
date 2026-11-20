# Obsidian local plugins

Build, test and deploy custom Obsidian plugins into a local vault. One folder per plugin under `plugins/`, one shared toolchain (TypeScript + esbuild), no per-plugin `package.json`. Set up so Claude Code can create and improve plugins on its own: see [CLAUDE.md](CLAUDE.md).

Requirements: Node ≥ 22 and Obsidian installed, then `npm install` once.

## Plugins

| Plugin | What it does |
|---|---|
| [TagEverything](plugins/tag-everything/README.md) (`tag-everything`) | Tag any file or folder from the file explorer; tags in the file name (`report[tax receipt].pdf`) or `.ts` sidecars; tag panel and explorer badges. `npm run tag-everything` builds and deploys it. |

## With Claude Code

From this folder, ask in plain words or use the skills:

```text
/new-plugin word-count-goals "show a progress bar toward a per-note word goal set in frontmatter"
/improve-plugin tag-everything "add a command to rename a tag across the whole vault"
```

Claude follows [docs/workflow.md](docs/workflow.md): it scaffolds, writes code and tests, runs the plugin in a **throwaway Obsidian** (`npm run smoke`), looks at the screenshot, updates the docs, and asks before deploying into one of your vaults.

## Quick start (by hand)

```powershell
npm run status                                   # each plugin: source / built / installed version, enabled?
npm run new -- my-plugin --name "My Plugin"      # scaffold plugins/my-plugin from templates/plugin
npm run dev -- my-plugin                         # rebuild + copy into the vault on every save
npm test -- my-plugin                            # unit tests
npm run smoke -- my-plugin                       # load it in a throwaway Obsidian, run tests/smoke.js, screenshot
npm run deploy -- my-plugin                      # one-off build + deploy
```

After a **first** deploy: Obsidian → **Settings → Community plugins** → turn off Restricted mode if asked → enable the plugin. After a redeploy: disable + enable it, or `Ctrl+P` → *Reload app without saving*. With the [Hot Reload](https://github.com/pjeby/hot-reload) community plugin in the vault, `npm run dev` changes load by themselves.

VS Code: **Terminal → Run Task** lists the same commands; `Ctrl+Shift+B` builds and deploys the plugin you pick.

## Commands

Every command takes plugin names (the folder name = manifest `id`); `build`, `test` default to all plugins, `--all` works everywhere.

| Command | What it does |
|---|---|
| `npm run status` | Table: source / built / installed version, whether the vault copy matches `dist/`, enabled or not |
| `npm run new -- <id> [--name N] [--description D]` | Copies `templates/plugin` to `plugins/<id>` |
| `npm run typecheck` | `tsc --noEmit` over every plugin |
| `npm run build [-- <id>]` | Type check, then bundle `src/main.ts` into `dist/<id>/` with `manifest.json` and `styles.css` |
| `npm test [-- <id>]` | `node --test` on `plugins/<id>/tests/**/*.test.ts` |
| `npm run smoke -- <id>` | Real Obsidian with a throwaway profile + vault (`tests/fixtures/vault`), enables the plugin, runs `tests/smoke.js`, screenshot in `dist/<id>-smoke.png`, fails on console errors. Never touches your vaults; works while Obsidian is open |
| `npm run dev -- <id>` | Watch + rebuild + deploy on save (`--no-deploy` to only build) |
| `npm run deploy -- <id>` | Build, then copy `dist/<id>` to `<vault>/.obsidian/plugins/<id>`. The previous copy goes to `backups/`; the plugin's saved settings (`data.json`) are never touched |
| `npm run undeploy -- <id>` | Moves the installed copy, settings included, to `backups/` |

**Which vault:** `--vault "C:\path\to\vault"` or `--vault <folder name>` of a vault Obsidian knows (e.g. `--vault Perso`), else `OBSIDIAN_VAULT`, else the vault Obsidian has open (read from `%APPDATA%\obsidian\obsidian.json`). Obsidian's location: `OBSIDIAN_EXE` (default `%LOCALAPPDATA%\Programs\obsidian\Obsidian.exe`).

## Layout

```
CLAUDE.md                instructions for Claude Code: conventions, safety, definition of done
docs/
  workflow.md            playbooks: new plugin, improve a plugin, debugging, release
  obsidian-api.md        API building blocks, internal APIs relied on, traps already hit
  testing.md             unit tests and the in-app smoke test contract
plugins/<id>/            one plugin
  manifest.json          id must equal the folder name, and must not contain "obsidian"
  src/main.ts            entry point (default export extends Plugin)
  src/*.ts               pure logic in modules that don't import "obsidian", so tests can run them
  styles.css             optional
  tests/*.test.ts        unit tests (node --test runs TypeScript directly)
  tests/smoke.js         in-app checks for npm run smoke
  tests/fixtures/vault/  optional vault the smoke test opens
  README.md              for users
  CLAUDE.md              for Claude: spec, architecture, invariants
templates/plugin/        starting point for npm run new
tools/                   build / dev / deploy / smoke / status scripts (plain Node + esbuild)
.claude/                 skills (/new-plugin, /improve-plugin) and command permissions
dist/ backups/           generated, git-ignored
```

## Conventions

The full list is in [CLAUDE.md](CLAUDE.md). In short: Obsidian theme variables only, class names prefixed with the plugin id, pure logic tested apart from the Obsidian wiring, `.ts` extensions in imports, fail gracefully with a `[plugin-id]` log prefix, no third-party brand in plugin names, bump `version` in `manifest.json` with each change.
