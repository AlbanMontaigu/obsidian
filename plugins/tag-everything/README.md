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

- **Right-click → Edit tags** on a file or folder; on a multi-selection, **Edit tags of N items**. Chips with autocomplete from every tag in the vault, most used first. With several items, a tag only some carry shows as `3/5`: leave it, click it to give it to all, or remove it from all. A word that can't be a tag (e.g. `a:b`) stays in the box with the reason, so you can fix it; a nested tag (`proj/alpha`) is refused up front where it can't go (a file name).
- **Tag naming rule** (setting *Tag naming rule*, on by default): a tag is **one lower-case plain word** (letters and digits, accents allowed), never a liaison word (`de`, `la`, `the`, `of`…; the list is in the settings, *Liaison words*). Typed upper case is lower-cased; a compound is refused and its fix put in the box instead (`Tax-Receipt` → `tax receipt`, two tags: press **Enter** to accept); a liaison word is left out. Tags of the vault that break the rule aren't offered as suggestions.
- **Check tag names** (command palette, or *Settings → Tag maintenance → Check and fix tag names*): re-reads every tag, then lists every tag of the vault that breaks the rule, how many items carry it, why, and a suggested fix (`B27` → `b27`, `plan_de_charge` → `plan charge`, `R&D` → `rd`, `de` → removed). Edit a fix if you want (several tags: separate them with spaces; empty: the tag is removed), untick the ones to leave, then **Fix N tags**: each tag is rewritten **where it is** (in the file name, the note's frontmatter or the sidecar; a renamed file keeps its links), and tag groups (formulas included: `Tax-Receipt` becomes `tax AND receipt`), bookmark tabs and the panel's search follow. Run it again to see what is left.
- A preview of the new file name before saving. Renames go through Obsidian, so **links in notes are updated**.
- Note tags edited anywhere else (the editor, the Properties panel, another app) show up live. Nested tags (`proj/alpha`) work for notes.
- **File tags panel** (ribbon `tags` icon): every tag with its count, frequently used tags a little bigger (at most 1.4× the normal size, rarely used ones stay at the normal size); select tags (AND) to list the matching files and folders. **Right-click a tag → Exclude this tag (NOT)** to leave out the items carrying it (shown as `NOT tag`, struck through, at the top); right-click it again to search with it instead. Type in **Filter tags** and press **Enter** to select the first match, **Escape** to clear it. Results work like the file explorer: click to open (Ctrl/Cmd-click or middle-click: new tab; non-note files open in their default app, folders are revealed), **Ctrl/Cmd + hover** for a page preview, **drag** one into a note to link it, right-click for the usual file menu. Everything in the panel works from the keyboard too (Tab, then Enter or Space). The panel remembers its selection and filter across restarts.
- **Tag groups** in the panel, to keep related tags together. **+** creates a group from the current search (its tags; excluded tags become `NOT tag` in the group's formula), or drop a tag on **+**. **Drag** any tag of the panel onto a group to add it; a tag can be in several groups. Groups **fold** (chevron) and can be reordered by dragging one onto another; **⋯** or right-click: rename, add the selected tags, delete (the tags stay on the files). Hover a tag of a group and click its × to take it out of the group.
- **A group is also a search**: click its **Search** button (it shows how many items the group finds), its name, or **⋯ → Search with this group**, to list the files and folders carrying **all** its tags (or matching its formula). The button turns into **Stop** while the group's search runs. Its tags then show at the top: click one to leave it out of the search (dashed), click again to put it back; click other tags to narrow further. Click the group again, or **Clear**, to stop. Groups are saved in the plugin's settings (`.obsidian/plugins/tag-everything/data.json`), not in your files.
- **Formulas**: **⋯ → Combine with a formula** turns a group into any combination of its tags, e.g. `(B27 OR INC) AND (q3 OR 2026)`. Operators `AND` / `OR` / `NOT` (or `ET` / `OU` / `NON`, `&` / `|` / `!`) and parentheses; two tags side by side mean AND; `NOT` binds first, then `AND`, then `OR`. Tag names complete as you type, and the dialog shows the formula as it understood it and how many items it finds (or what is wrong). The group then shows its tags between the operators. In a group search, a tag switched off drops out of its `OR` / `AND` as if it were not written, `NOT x` included. Dropping a tag on a group with a formula adds `AND tag`; its × removes the tag from the formula. **NOT without typing**: hover a tag of a group and click its ⊘ button (or right-click it) to exclude it from the group's search (`NOT tag`, struck through); click it again (↶) to include it again. A group without a formula gets one (`a AND NOT b`). Empty the formula to go back to "all the tags". Tags are matched whatever the case; a tag in quotes can contain a parenthesis or be spelled like an operator (`"ou"`).
- **Bookmark tabs**: under the filter box, the panel has a tab **All** (every group and tag) and as many named tabs as you want. **+** next to the tabs creates one (drop a tag or a group on **+** to start the tab with it). Bookmark a tag or a group in a tab by **dragging it onto the tab's name**, or right-click it → **Bookmark in the tab "…"** (or **Bookmark in a new tab…**). A tab shows only the groups and tags bookmarked in it, so you can keep e.g. a *Work* and a *Home* view; the same menu item **Remove from the tab "…"** takes one out (the tag stays on your files, the group stays in **All**). A group created with **+** while a tab is shown is bookmarked in it. Right-click a tab to rename or delete it (deleting a tab deletes nothing else). The search and its results are the same whatever the tab; the panel reopens on the tab you left. Tabs are saved with the groups in `data.json`.
- **Colours**: each tag gets its own colour, picked from its name among the theme colours (always the same, in the panel, the badges and the editor; nested tags share their parent's colour). A colour stored in a sidecar wins. Setting *Colour tags automatically* turns it off. With 8 colours, two tags can share one.
- **Badges** in the file explorer (optional), in the tag colours. Clicking a badge opens the panel on that tag.
- When a file is renamed or moved in Obsidian, its `.ts` sidecar and thumbnail move with it.
- Command palette: *Edit tags of the current file*, *Open file tags panel*, *Check tag names (naming rule) and fix them*, *Re-read all tags*. Both are also buttons in *Settings → Tag maintenance*.
- Tagging more than 5 items shows its progress; if some fail, one notice lists why (the first 5, then how many more). Edits run one after the other, so a second edit started before the first is written waits for it.

## Install

From the repo root (see the [root README](../../README.md)):

```powershell
npm run tag-everything                          # build + deploy into the open vault
npm run deploy -- tag-everything --vault Perso
```

Needs Obsidian 1.13 or later (desktop). Then in Obsidian: **Settings → Community plugins** → turn off Restricted mode if needed → enable **TagEverything**. After a redeploy, disable/enable it or reload Obsidian.

Its settings (**Settings → TagEverything**) also show up when you type in the settings search box, e.g. "badges" or "sidecar".

Turn on **Settings → Files and links → Detect all file extensions** to see (and right-click) PDFs, Office files and images in the explorer.

## Develop

```powershell
npm test -- tag-everything                      # format unit tests
npm run smoke -- tag-everything                 # 140 checks in a throwaway Obsidian + dist/tag-everything-smoke.png
npm run dev -- tag-everything                   # rebuild + redeploy on save
node plugins/tag-everything/tools/check-vault.ts "<vault>"   # read-only: every tagged name round-trips
```

Architecture, invariants and test notes: [CLAUDE.md](CLAUDE.md).

## Limits

- Only files Obsidian has loaded can be tagged. Folders in **Excluded files** are still loaded; that setting only hides them from search.
- Obsidian does not watch `.ts` folders. Tags changed in another app show up after **Re-read all tags** (panel ↻ button, command or settings), after **Check tag names** (it re-reads first), or on the next start. Name tags update live.
- Badges use the explorer's internal markup (no public API). If an Obsidian update changes it, badges disappear and everything else keeps working.
- A file name is capped at 255 characters; tagging that would exceed it is refused. Tags cannot contain spaces or `[ ] # ^ | \ / : * ? " < >` (`/` is allowed for notes, as a nested tag). With the naming rule on (default), a new tag is a single lower-case word made of letters and digits only.
- The naming rule only applies to new tags; existing ones stay until you run **Check tag names**. A nested tag whose parent level holds several words (`my-proj/alpha`) has no automatic fix: type one. Inline `#tags` in a note's text aren't checked (they aren't read).
- Only frontmatter tags of a note are read, not `#tags` written in its text.
- A note whose frontmatter isn't valid YAML is left untouched: fix it in Obsidian first.
- Tags in a note's frontmatter aren't visible to other tag-aware file managers. Turn **Note tags in frontmatter** off to tag notes the same way as other files.

## Layout

```
src/format.ts      storage format: parse/write name tags, sidecar JSON, paths, where tags go (pure, tested)
src/index.ts       in-memory tag index of the vault (name tags live, sidecars scanned)
src/store.ts       sidecar read/write and moves through the vault adapter
src/modal.ts       chip editor with autocomplete
src/naming.ts      tag naming rule: check, suggested fix, vault audit, fix planning (pure, tested)
src/fix-modal.ts   Check tag names dialog
src/view.ts        File tags side panel, tag groups and bookmark tabs UI
src/groups.ts      tag groups: add, rename, move, fold, formula, load safely (pure, tested)
src/tabs.ts        bookmark tabs of the panel: add, rename, bookmark tags and groups, load safely (pure, tested)
src/formula.ts     tag formulas: parse, format, evaluate, switch tags off (pure, tested)
src/cloud.ts       tag cloud sizing by use (pure, tested)
src/colors.ts      automatic tag colours (pure, tested)
src/badges.ts      explorer badges
src/config.ts      settings: shape, defaults, loading a damaged data.json (pure, tested)
src/messages.ts    notice texts (pure, tested)
src/main.ts        plugin wiring: menus, commands, rename handling, applying edits
docs/format.md     storage format spec
tests/             *.test.ts (node --test), smoke.js + fixtures/vault (in-app)
tools/check-vault.ts  read-only check of every tagged name in a vault (round-trip, and name tags breaking the naming rule)
```
