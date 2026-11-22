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
- Browse in the **TagEverything explorer** (left sidebar), a tree of tags that looks like the file explorer: every tag
  at the root, inside a tag the tags found with it, then the files carrying exactly those tags (even files Obsidian's
  explorer hides); hover a file's folder icon to see where it really is, click it to show it in the file explorer.
- Save searches as **tag groups**, with **formulas** (`(b27 OR inc) AND NOT draft`), and sort them into **bookmark
  tabs**.
- See how many tags each item has in the file explorer (hover the number to list them); each file's extension (`pdf`, `md`) is a tag too, shown before its name.
- Write a **guide for AI assistants** (`CLAUDE.md`) into a folder, so an assistant working in the vault tags files the
  way TagEverything reads them and reuses your tags.
- **Suggest tags with Claude Code**: it reads the files of a folder (read-only) and suggests tags, reusing the ones
  already in your vault; you pick which to add.
- Put **live lists in your notes**: a `tag-everything` code block (`invoice AND NOT paid`) lists the matching files,
  PDFs and Office files included, and follows the vault as it changes.
- **Rename or merge a tag** everywhere in one step, and **review your tags**: look-alikes (`facture`, `factures`),
  synonyms found by Claude Code from the tag list alone (`banque`, `bancaire`), tags used once.
- Empty the **inbox** of files without tags: **auto-tag rules** ("every PDF in Bank whose name has invoice gets bank
  invoice") offer the tags in one click, or tag new files as they arrive.
- **Exclude** files and folders from the tag engine (right-click, or rules): ignored everywhere, their tags kept, an
  eye-off icon in the file explorer.

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
npm run smoke -- tag-everything                 # ~220 checks in a throwaway Obsidian + dist/tag-everything-smoke.png
npm run dev -- tag-everything                   # rebuild + redeploy on save
node plugins/tag-everything/tools/check-vault.ts "<vault>"   # read-only: every tagged name round-trips
```

| Document | For |
|---|---|
| [docs/user-guide.md](docs/user-guide.md) | Users: every feature, command, setting and limit |
| [docs/architecture.md](docs/architecture.md) | Developers: layers, data flow, index, search, module reference (Mermaid diagrams) |
| [docs/format.md](docs/format.md) | The storage format (file names, sidecars, frontmatter), compatibility with other apps |
| [CLAUDE.md](CLAUDE.md) | Claude Code (and anyone changing the code): where to change what, invariants, tests, guidelines |
| [docs/known-limits.md](docs/known-limits.md) | Developers: known limits and ideas not done |

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
src/claude-runner.ts  starts Claude Code in the app (Node through Electron)
src/view.ts        TagEverything panel: groups and tags in tabs, the search and its results in Selection, Inbox, Tools
src/explorer.ts    TagEverything explorer: the tree of tags
src/explore.ts     the explorer's tree nodes and row order (pure, tested)
src/items.ts       a file row in every view: how it looks, open, preview, drag, file menu
src/query.ts       query blocks: read the block, match, order (pure, tested)
src/query-block.ts query blocks rendered in notes, live
src/taxonomy.ts    tag review: look-alikes, synonym prompt and answer, merge map (pure, tested)
src/curator.ts     rename / merge a tag, tag picker, review dialog
src/inbox.ts       auto-tag rules and the inbox list (pure, tested)
src/inbox-pane.ts  the Inbox tab of the panel
src/tools-pane.ts  the Tools tab of the panel (vault-wide actions)
src/rule-modal.ts  the auto-tag and exclusion rule dialog
src/exclude.ts     excluded paths and exclusion rules (pure, tested)
src/menu.ts        the TagEverything context submenu
src/dialogs.ts     name and group (name + formula) dialogs, tag and folder completion
src/settings.ts    settings tab
src/badges.ts      explorer badges
docs/              user guide, architecture, storage format
tests/             *.test.ts (node --test), smoke.js + fixtures/vault (in-app)
tools/check-vault.ts  read-only check of every tagged name in a vault
```
