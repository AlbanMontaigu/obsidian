# TagEverything (Obsidian plugin)

Tag any file or folder of an Obsidian vault (notes, PDFs, Office files, images, folders) from the file explorer, then
find them again by their tags. Notes keep their tags in their frontmatter, like Obsidian. Other files keep theirs in
the file name (`report[tax receipt].pdf`) or in `.ts` sidecar files, so TagEverything is mostly compatible with
TagSpaces.

**User guide: [docs/user-guide.md](docs/user-guide.md)**, covering every feature, command and setting, plus limits.

## What you can do

- **Edit tags** of a file, a folder or a multi-selection (right-click → **TagEverything**), with autocomplete and a preview of the new
  file name. Renames go through Obsidian, so links in notes are updated.
- Keep tags tidy with the **naming rule** (one lower-case word per tag, no liaison word), and fix the whole vault with
  **Check tag names**.
- Search in the **TagEverything panel**: click tags (AND), exclude some (NOT), open, preview or drag the results.
- Save searches as **tag groups**, with **formulas** (`(b27 OR inc) AND NOT draft`), and sort them into **bookmark
  tabs**.
- See tags as coloured **badges** in the file explorer; each file's extension (`pdf`, `md`) is a tag too, shown before its name.
- Write a **guide for AI assistants** (`CLAUDE.md`) into a folder, so an assistant working in the vault tags files the
  way TagEverything reads them and reuses your tags.
- **Suggest tags with Claude Code**: it reads the files of a folder (read-only) and suggests tags, reusing the ones
  already in your vault; you pick which to add.

## Install

From the repo root (see the [root README](../../README.md)):

```powershell
npm run tag-everything                          # build + deploy into the open vault
npm run deploy -- tag-everything --vault Perso
```

Needs Obsidian 1.13 or later (desktop). Then in Obsidian: **Settings → Community plugins** → turn off Restricted mode
if needed → enable **TagEverything**. After a redeploy, disable and re-enable it, or reload Obsidian. To tag PDFs and
Office files, turn on **Settings → Files and links → Detect all file extensions**.

## Develop

```powershell
npm test -- tag-everything                      # unit tests of the pure modules
npm run smoke -- tag-everything                 # ~180 checks in a throwaway Obsidian + dist/tag-everything-smoke.png
npm run dev -- tag-everything                   # rebuild + redeploy on save
node plugins/tag-everything/tools/check-vault.ts "<vault>"   # read-only: every tagged name round-trips
```

| Document | For |
|---|---|
| [docs/user-guide.md](docs/user-guide.md) | Users: every feature, command, setting and limit |
| [docs/architecture.md](docs/architecture.md) | Developers: layers, data flow, index, search, module reference (Mermaid diagrams) |
| [docs/format.md](docs/format.md) | The storage format (file names, sidecars, frontmatter), compatibility with other apps |
| [CLAUDE.md](CLAUDE.md) | Claude Code (and anyone changing the code): invariants, tests, guidelines, known limits |

## Layout

```
src/format.ts      storage format: parse/write name tags, sidecar JSON, paths, where tags go (pure, tested)
src/naming.ts      tag naming rule: check, suggested fix, vault audit, fix planning (pure, tested)
src/formula.ts     tag formulas: parse, format, evaluate, switch tags off (pure, tested)
src/groups.ts      tag groups: add, rename, move, fold, formula, load safely (pure, tested)
src/tabs.ts        bookmark tabs: add, rename, bookmark tags and groups, load safely (pure, tested)
src/config.ts      settings: shape, defaults, loading a damaged data.json (pure, tested)
src/suggest.ts     Claude Code suggestions: prompt, command line, reading and cleaning the answer (pure, tested)
src/claude.ts      runs a program (Claude Code): stdin, stdout, timeout, cancel, not found (tested with real processes)
src/cloud.ts       tag cloud sizing by use (pure, tested)
src/colors.ts      automatic tag colours (pure, tested)
src/messages.ts    notice texts (pure, tested)
src/guide.ts       the AI assistant guide (CLAUDE.md) text (pure, tested)
src/ui.ts          small DOM helpers shared by the UI modules (autocomplete ranking tested)
src/index.ts       in-memory tag index of the vault (name tags live, sidecars scanned)
src/store.ts       sidecar read/write and moves through the vault adapter
src/main.ts        plugin wiring: menus, commands, rename handling, applying edits
src/modal.ts       tag editor (chips + autocomplete)
src/fix-modal.ts   Check tag names dialog
src/suggest-modal.ts  the suggestions dialog: runs Claude Code, chips to leave tags out, adds the rest
src/view.ts        TagEverything panel: cloud, search, groups, bookmark tabs, results
src/dialogs.ts     the panel's name and formula dialogs
src/settings.ts    settings tab
src/badges.ts      explorer badges
docs/              user guide, architecture, storage format
tests/             *.test.ts (node --test), smoke.js + fixtures/vault (in-app)
tools/check-vault.ts  read-only check of every tagged name in a vault
```
