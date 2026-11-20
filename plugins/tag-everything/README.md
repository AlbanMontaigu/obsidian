# TagEverything (Obsidian plugin)

Tag any file or folder of an Obsidian vault (notes, PDFs, Office files, images, folders) from the file explorer. Notes keep their tags in their frontmatter, like Obsidian. Other files keep theirs in the file name or in `.ts` sidecar files. TagEverything is mostly compatible with TagSpaces. Format details: [docs/format.md](docs/format.md).

| Item | Where new tags go | Example |
|---|---|---|
| Markdown note, setting **Note tags in frontmatter** (default: on) | The note's `tags` property, as Obsidian stores it. The note is not renamed. | `tags: [B27, proj/alpha]` |
| Other file, setting **File name** (default) | First `[...]` group of the name, space-separated | `B27_Board_v10[B27 INC].docx` |
| Other file, setting **Sidecar** | `<folder>/.ts/<file name>.json` → `tags` | `.ts/B27_Board_v10.docx.json` |
| Folder (always) | `<folder>/.ts/tsm.json` → `tags` | `B27/.ts/tsm.json` |

Tags are always **read from every place and merged**. For a note, that's the tags in its name, plus its frontmatter tags, plus its sidecar tags. A note named `budget[B27 INC].md` with `tags: [q3]` shows `B27 INC q3`. When you edit it, the name tags you keep stay in the name, and new tags go to the frontmatter. Folder names are never read for tags. Other fields in a sidecar or `tsm.json` (id, description, perspective, custom order, tag colours) and other note properties are kept.

## Features

- **Right-click → Edit tags** on a file or folder; on a multi-selection, **Edit tags of N items**. Chips with autocomplete from every tag in the vault, most used first. With several items, a tag only some carry shows as `3/5`: leave it, click it to give it to all, or remove it from all.
- A preview of the new file name before saving. Renames go through Obsidian, so **links in notes are updated**.
- Note tags edited anywhere else (the editor, the Properties panel, another app) show up live. Nested tags (`proj/alpha`) work for notes.
- **File tags panel** (ribbon `tags` icon): every tag with its count; select tags (AND) to list the matching files and folders; click to open (non-note files open in their default app, folders are revealed), right-click for the usual file menu.
- **Badges** in the file explorer (optional), coloured with the tag colours stored in sidecars. Clicking a badge opens the panel on that tag.
- When a file is renamed or moved in Obsidian, its `.ts` sidecar and thumbnail move with it.
- Command palette: *Edit tags of the current file*, *Open file tags panel*, *Re-read all tags*.

## Install

From the repo root (see the [root README](../../README.md)):

```powershell
npm run tag-everything                          # build + deploy into the open vault
npm run deploy -- tag-everything --vault Perso
```

Then in Obsidian: **Settings → Community plugins** → turn off Restricted mode if needed → enable **TagEverything**. After a redeploy, disable/enable it or reload Obsidian.

Turn on **Settings → Files and links → Detect all file extensions** to see (and right-click) PDFs, Office files and images in the explorer.

## Develop

```powershell
npm test -- tag-everything                      # format unit tests
npm run smoke -- tag-everything                 # 44 checks in a throwaway Obsidian + dist/tag-everything-smoke.png
npm run dev -- tag-everything                   # rebuild + redeploy on save
node plugins/tag-everything/tools/check-vault.ts "<vault>"   # read-only: every tagged name round-trips
```

Architecture, invariants and test notes: [CLAUDE.md](CLAUDE.md).

## Limits

- Only files Obsidian has loaded can be tagged. Folders in **Excluded files** are still loaded; that setting only hides them from search.
- Obsidian does not watch `.ts` folders. Tags changed in another app show up after **Re-read all tags** (panel ↻ button), or on the next start. Name tags update live.
- Badges use the explorer's internal markup (no public API). If an Obsidian update changes it, badges disappear and everything else keeps working.
- A file name is capped at 255 characters; tagging that would exceed it is refused. Tags cannot contain spaces or `[ ] # ^ | \ / : * ? " < >` (`/` is allowed for notes, as a nested tag).
- Only frontmatter tags of a note are read, not `#tags` written in its text.
- A note whose frontmatter isn't valid YAML is left untouched: fix it in Obsidian first.
- Tags in a note's frontmatter aren't visible to other tag-aware file managers. Turn **Note tags in frontmatter** off to tag notes the same way as other files.

## Layout

```
src/format.ts      storage format: parse/write name tags, sidecar JSON, paths, where tags go (pure, tested)
src/index.ts       in-memory tag index of the vault (name tags live, sidecars scanned)
src/store.ts       sidecar read/write and moves through the vault adapter
src/modal.ts       chip editor with autocomplete
src/view.ts        File tags side panel
src/badges.ts      explorer badges
src/main.ts        plugin wiring: menus, commands, rename handling, applying edits
docs/format.md     storage format spec
tests/             format.test.ts (node --test), smoke.js + fixtures/vault (in-app)
tools/check-vault.ts  read-only check of every tagged name in a vault
```
