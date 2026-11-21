# TagEverything: notes for Claude

Read the root `CLAUDE.md` first, then **`docs/architecture.md`** (layers, write path, index, search, module
reference) before changing code. Users' view: `docs/user-guide.md`. Storage format spec: `docs/format.md`.

## What it does

Tag any file or folder of a vault from the file explorer (right-click → *TagEverything* submenu, multi-selection, command). Markdown notes:
tags in the frontmatter `tags` property (Obsidian-native, setting `noteTagsInFrontmatter`, on by default). Other
files: tags in the file name (`report[tax receipt].pdf`) or in `.ts` sidecar JSON files; mostly compatible with
TagSpaces. Reading always merges name + frontmatter + sidecar tags. A side panel lists every tag and filters by
tags (AND), with foldable tag groups that double as saved searches, and named bookmark tabs that show only the tags
and groups bookmarked in them; badges show tags in the explorer. The **TagEverything explorer** (left sidebar) is a
tree of tags: every tag at the root, inside a tag the tags found with it, then the files carrying exactly the path's
tags (a file shows at the end of each path made of its tags), even files the core explorer hides. Every file
also carries its extension as a derived, never-written tag (`pdf`,
`md`; setting `extensionTags`, on by default), shown before its name in the explorer. *Write AI assistant guide* (folder menu, or a command
for the vault root) writes a `CLAUDE.md` telling an AI assistant how tags are stored and which exist; never over an
existing one. *Suggest tags with Claude Code* (folder, file or selection menu, a command) runs `claude -p` read-only in
the folder and lists the tags it suggests, reusing the vault's tags; the user picks, the plugin writes. A **tag naming rule** (on by default) makes every
new tag one lower-case plain word, no liaison word; the command *Check tag names* audits the vault and fixes the tags
that break it, where they are.

## Where to change what

| Change | Start in | Also update |
|---|---|---|
| How tags are parsed / written in names, sidecars, frontmatter | `format.ts` (pure) | `docs/format.md`; the AI assistant guide text (`guide.ts`), which restates the format for vaults; run `tools/check-vault.ts` |
| Naming rule, fixes, *Check tag names* | `naming.ts` (pure), `fix-modal.ts` | user guide §3-4 |
| Anything that writes tags | `main.ts` `applyTags` / `replaceTags` → `enqueue` → `applyOne` (one path; add a `Planner`, not a new path) | invariants below |
| Panel search, groups, formulas, tabs | `formula.ts` / `groups.ts` / `tabs.ts` (pure), then `view.ts`, `dialogs.ts` | user guide §5-7 |
| A setting | `config.ts` (shape, default, `normalizeSettings`), `settings.ts` (row) | user guide §11 |
| The AI assistant guide (`CLAUDE.md` written into a folder) | `guide.ts` (pure), `main.ts` `writeGuide` | user guide §9 |
| Claude Code suggestions (prompt, flags, answer) | `suggest.ts` (pure), `claude.ts` (process), `suggest-modal.ts`, `main.ts` `suggestTags` / `runClaude` / `addTagsEach` | user guide §9; check a real run by hand (smoke fakes it) |
| The TagEverything explorer (tree nodes, rows, icon) | `explore.ts` (pure), `explorer.ts` | user guide §10 |
| What a file row does (open, preview, drag, file menu), panel and explorer | `items.ts` | |
| Shared DOM bits (keyboard buttons, chip colour, autocomplete) | `ui.ts`: reuse before writing a new one | |

Every change also updates `docs/architecture.md` (module reference, diagrams) when a module's role or a flow changes,
and `docs/user-guide.md` when users see it.

## Invariants (keep them)

1. A file's tags = name tags ∪ frontmatter tags (`.md` only) ∪ sidecar tags, whatever the settings. A folder's
   tags = `tsm.json` tags only. With `extensionTags` (on by default) the file's extension tag comes first in
   `tagsOf`: derived from the name, **never written**. What edits or lists stored tags (editor, `replaceTags`,
   *Check tag names*, the guide's lists) uses `ownTagsOf` / `counts(paths, true)`.
2. The format stays compatible with `docs/format.md`. Never write `tsi.json` / `tsl.json`.
3. Never lose a tag: rename, then frontmatter, then sidecar. Kept tags never move between name and frontmatter; tags
   only move out of the sidecar, so a failure part-way can leave a tag in two places, never in neither.
4. Never overwrite metadata that wasn't parsed (sidecar JSON, note frontmatter YAML). Never overwrite an existing
   file on rename or move.
4b. A tag goes where it is valid: no nested tag (`a/b`) in a file name (`assertWritable`).
4c. Naming rule (when on): no **new** tag breaks it (editor and `applyTags`). Existing tags are only changed by the
   explicit fix (*Check tag names*), and a fix rewrites a tag where it is: it never moves between name, frontmatter
   and sidecar.
5. One failing item never stops a batch; failures are listed in one `Notice`.
6. Renames go through `fileManager.renameFile` so links in notes are updated.
7. Claude Code never writes: it gets only the Read, Glob and Grep tools (`--tools`, `dontAsk`), and its answer is
   cleaned (`cleanSuggestions`) and written by the plugin through `addTagsEach`, after the user's review. Started
   without a shell (no quoting of the prompt or the schema), the prompt on stdin.

## Tests

- `tests/format.test.ts`: the format, including frontmatter shapes, planning per target, round-trips and refusals, `parseTagInput`, `extensionTag`.
- `tests/config.test.ts`: `normalizeSettings` on missing / damaged data (naming rule, liaison words, extension tags on for an old `data.json`, Claude Code program and model), message texts.
- `tests/naming.test.ts`: the rule (accents, digits), problems, fixes (compounds, `/` like `-`, elisions, acronyms), every fix follows the rule, liaison word list, editor input, audit, `replacePlan` (in place, no duplicate), `parseReplacement`, formula / group / tab follow-up.
- `tests/cloud.test.ts`: cloud sizing bounds, log scale, levels, monotonic.
- `tests/colors.test.ts`: automatic colours stable, case / `#` / nested roots, spread over the palette.
- `tests/groups.test.ts`: group operations, multi-membership, no mutation, reorder, loading malformed data, formulas.
- `tests/tabs.test.ts`: tab operations, bookmark once / remove, no mutation, a deleted group leaves the tabs, loading malformed data.
- `tests/formula.test.ts`: syntax (French / English / symbols, precedence, quotes), round-trip, errors, evaluate, prune, case resolution, `requiredTags`.
- `tests/ui.test.ts`: autocomplete ranking (`matchTags`).
- `tests/explore.test.ts`: tree nodes (root = every tag and no item, a tag's branches and its own items, an item at the
  end of every path of its tags, from the parent's paths = from the vault, dead end), name order, folders first, the
  formula box (`treeSearch`: empty, vault spelling, unknown tags pruned and named, syntax error keeps the last).
- `tests/smoke.js` + `tests/fixtures/vault/`: ~180 in-app checks. Extension tags are checked on by default, then
  turned off for the exact tag lists of the engine sections, and get their own section before the screenshot (first
  tag, counted per file not per folder, not an own tag, `data.json`, not in the editor, explorer chip **before** the
  name of a revealed PDF row with Obsidian's label hidden, panel result rows with the extension chip in place of the
  icon and not repeated in the tags below, setting off removes them and brings the icon back). Menus: the plugin's items in one *TagEverything* submenu (fake menus, and the real explorer menu, which proves the internal `setSubmenu` still exists); the editor title, a notice and the panel name start with the plugin's name. The first part runs the name / sidecar engine on
  notes with `noteTagsInFrontmatter = false`; the "notes: frontmatter" part turns it on (merge, no rename on add,
  rename on name-tag removal, new frontmatter block, sidecar → frontmatter, live external edit, invalid YAML
  refused, PDF still renamed, nested tag refused in a name); robustness (a sidecar edit and a folder rename during `rebuild()` are kept, two
  concurrent edits queued, an item deleted since the editor opened refused, editor keeps an invalid word and saves
  once fixed); then panel, badges (a round pill with the number of tags on a visible row, hover lists them one per line, the list stays while hovered and closes after, a no-op refresh keeps the DOM), settings (declarative rows indexed for search, tab icon; in the
  real settings dialog, the badges toggle disables / enables the badge option and is saved to `data.json`), tag groups (create through the
  dialog, drag with a synthetic `DataTransfer`, fold, `data.json`, group search, switch a tag off / on; formula through the real menu and dialog: error, preview,
  rendering, search, switch-off pruning, NOT, drop = AND, × prunes; the ⊘ NOT button on group chips, with and without a formula; excluding a cloud tag through its right-click menu, saved state, **+** turning it into a `NOT` formula), panel usability (filter + Enter, keyboard,
  saved state, labelled group search button "Search" / "Stop", group menu starting with it, draggable results, hover source), bookmark tabs (+ creates and shows one,
  bookmark by dropping a tag and a group on the tab and through the tag menu, All unchanged, a tab shows only its bookmarks, `data.json` and panel state, a group
  created in a tab is bookmarked there and leaves it when deleted), modal; naming rule: the editor lower-cases, puts a
  compound's fix in the box (Enter accepts, Save waits), leaves a liaison word out, `applyTags` refuses, settings
  toggle (liaison words disabled, lower-case freed, saved); *Check tag names*: tags planted with the rule off
  (`Tax-Receipt` in a PDF name, `plan_de_charge` / `de` in a frontmatter, the nested `proj/alpha` in a note's
  frontmatter) plus the fixture's `B27 INC IMAC` are listed with their fixes, an invalid edited fix disables Fix, one row unticked, then the fix: case-only rename
  `budget[B27 INC].md` → `budget[b27 inc].md` (Windows), split in the name, `proj/alpha` split in the frontmatter (`alpha` not repeated), frontmatter tag dropped, unticked one kept,
  group formula + `data.json` + panel search follow, a second check lists only what was left; a folder sidecar written with `adapter.write` (no vault event) is found because the check re-reads first, and fixed in its sidecar; the two *Tag maintenance* settings rows (re-read notice, check dialog: both in the settings **window**); the AI assistant guide (folder menu item writes `Projects/CLAUDE.md` with the folder's tags, an edited one is skipped, a lower-case `claude.md` blocks it, the root command writes one without folder section; all deleted after); Claude Code suggestions with `plugin.runClaude` faked (folder menu → dialog, working folder, prompt with items, tags and dictionary, made-up path ignored, tag already there dropped, compound split, new tag dashed, cost / time, a tag switched off, Add writes the rest to a folder sidecar and a note's frontmatter; a selection's common folder; a non-JSON answer shown as an error; closing cancels; the real runner with a missing program explains the setting); the TagEverything explorer (command, hover source,
  left sidebar, its own icon on the tab, no folder mode; root = every stored tag; the formula box (`KP` suggests kpi and
  leaves the tree whole, picking it keeps the items carrying kpi, Enter opens its path, `kpi AND` warns and keeps the
  search, `shared et non final`, Escape clears); with `showUnsupportedFiles` off a
  created `board[kpi q1].docx` sits under kpi › q1 and q1 › kpi, not under kpi; its row = extension badge, name, pill
  `2` listing its tags on hover, folder icon whose tooltip names `Docs`; open tags saved; a click closes a tag; the
  TagEverything menu item and the folder icon show a note in the file explorer; a click opens a note, highlighted, the
  highlight follows the editor). It ends with the explorer showing the path to that note (left) and the panel in the
  bookmark tab "Work", with a formula
  group search with a `NOT` and a tag switched off (notices removed) for the screenshot. Run
  `npm run smoke -- tag-everything`.
- `tools/check-vault.ts "<vault>"`: **read-only**, folder listings only (no file content, so OneDrive
  files-on-demand stay in the cloud); every tagged name in a real vault must round-trip unchanged
  (2026-11-20 on the owner's vault: 9 500 files, 70 tagged names, 0 problems). Run it after any change to
  `parseNameTags` / `setNameTags`. It also lists the **name** tags breaking the naming rule with their fix (frontmatter
  and sidecar tags are not read there: *Check tag names* in Obsidian sees them all).

## Official guidelines

Audited on 2026-11-20 (0.8.0) against the official guidelines (summary and linter how-to: root
`docs/obsidian-api.md` → *Official guidelines*). The official linter `eslint-plugin-obsidianmd` 0.6.0, run from this
folder with `ui/sentence-case` on, reports one false positive: the formula placeholder `(tag1 OR tag2) AND tag3`.
Keep it that way: computed styles via `setCssProps` (CSS variables), `instanceof TFile` and never a cast,
`.instanceOf()` for DOM nodes and events (panel and settings may be in a pop-out window), `async` / `await`.

Deliberate exceptions, each for a reason:

- `vault.adapter` for `.ts` sidecars: dot-folders are invisible to the Vault API.
- Internal APIs (explorer `fileItems`, `revealInFolder`, `openWithDefaultApp`, `dragManager`, `getConfig`): no
  public equivalent; all guarded, they degrade to doing nothing.
- No `normalizePath()` on the paths it builds: they come from vault paths Obsidian already normalized, and
  normalizing again (NFC, non-breaking spaces) could point at a different file. Nothing here is a user-typed path.
- `isDesktopOnly: true` and an unminified `main.js`: a personal desktop plugin; readable stack traces matter more.

## Known limits / ideas not done

- `.ts` changes made outside Obsidian need a rebuild (no watcher on dot-folders). A file-system watcher on the
  vault base path (desktop `fs.watch`) would fix it.
- Badges rely on internal explorer markup (the extension chip also on Obsidian's `.nav-file-tag` class, to hide it).
  The pill's tag list opens on hover or click only, not from the keyboard (the panel is).
- Extension tags: a name tag equal to the extension (`x[pdf].pdf`) is allowed (stored, shown once). With `md` on
  every note, the index holds every file of the vault, so badges and the panel's search loop over all of them
  (not measured on the owner's 9 500-file vault).
- The owner's main vault has *Detect all file extensions* off: Obsidian still loads every file (the plugin indexes
  and tags them), but its explorer hides Office files and other unsupported types, so their badges and right-click
  menu are only reachable from the TagEverything explorer or the panel (checked on 1.15.1, 2026-11-21).
- The explorer redraws the open nodes on every index or vault change, debounced; a node lists at most 500 files.
  Not measured on the owner's 9 500-file vault (the root scans every indexed path, each open node its parent's).
  A file with n tags shows in n! places once all are opened (only what is opened is drawn). Untagged files are not
  in the tree. Showing a file the core explorer hides in the file explorer only opens its folder.
- Explorer ideas: reveal the active file in the tree, keyboard arrows between rows,
  extension tags as branches (an option).
- Inline `#tags` in a note's body are not read (only frontmatter): they can't be removed through a property edit.
- Tag groups don't follow a tag renamed outside the panel (they keep the old name, shown faded); they do follow a
  *Check tag names* fix.
- Naming rule: inline `#tags` in a note body are neither read nor fixed. `/` splits like `-`, so the rule allows no
  nested tag (turn it off to use them in notes). A tag fixed in a file name on a case-sensitive disk relies on Obsidian's rename (tested on
  Windows only). The liaison word list is a guess: the owner can edit it in the settings.
- Deleting a file in Obsidian leaves its `.ts` sidecar (orphan, ignored by the scan); a file created later with the
  same name would pick its tags up at the next rebuild. Not deleted on purpose (never delete metadata unasked).
- The panel re-renders on every index change even when hidden (cheap: counts are cached and the search runs once per render).
- The AI assistant guide is a snapshot (tag lists, settings) and is never overwritten, so it goes stale: the owner
  deletes and rewrites it. A refresh that rewrites only a marked section of an existing `CLAUDE.md` would fix it, but
  touches a file the owner may have edited (not done: never overwrite).
- Claude Code suggestions: the smoke test fakes Claude Code (cost, login, non-deterministic): after changing the
  prompt or the flags, run it once for real on a small folder. An npm `claude.cmd` can't be spawned without a shell:
  the setting must point to the `.exe`. At most 50 items per run; the prompt lists at most 300 vault tags. Folder
  tags are suggested from what the folder holds. Claude Code's `--safe-mode` / `--tools` flags are from 2.1.x: an
  older CLI refuses them (the dialog shows its error).
- Ideas: rename / merge a tag everywhere (the engine exists: `plugin.replaceTags(new Map([[old, [new]]]))`; only a
  UI is missing, e.g. a tag menu item *Rename tag…*); colours editable in settings; tag search in the quick
  switcher; a command to move a note's name tags into its frontmatter (renames the note, so opt-in).
