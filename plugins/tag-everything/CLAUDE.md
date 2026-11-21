# TagEverything: notes for Claude

Read the root `CLAUDE.md` first, then **`docs/architecture.md`** (layers, write path, index, search, module
reference) before changing code. Users' view: `docs/user-guide.md`. Storage format spec: `docs/format.md`.

## What it does

Tag any file or folder of a vault from the file explorer (right-click → *TagEverything* submenu, multi-selection, command). Markdown notes:
tags in the frontmatter `tags` property (Obsidian-native, setting `noteTagsInFrontmatter`, on by default). Other
files: tags in the file name (`report[tax receipt].pdf`) or in `.ts` sidecar JSON files; mostly compatible with
TagSpaces. Reading always merges name + frontmatter + sidecar tags. A side panel lists every tag and filters by
tags (AND), with foldable tag groups that double as saved searches, and named bookmark tabs that show only the tags
and groups bookmarked in them; badges show tags in the explorer. *Write AI assistant guide* (folder menu, or a command
for the vault root) writes a `CLAUDE.md` telling an AI assistant how tags are stored and which exist; never over an
existing one. A **tag naming rule** (on by default) makes every
new tag one lower-case plain word, no liaison word; the command *Check tag names* audits the vault and fixes the tags
that break it, where they are.

## Where to change what

| Change | Start in | Also update |
|---|---|---|
| How tags are parsed / written in names, sidecars, frontmatter | `format.ts` (pure) | `docs/format.md`; the AI assistant guide text (`guide.ts`), which restates the format for vaults; run `tools/check-vault.ts` |
| Naming rule, fixes, *Check tag names* | `naming.ts` (pure), `fix-modal.ts` | user guide §3-4 |
| Anything that writes tags | `main.ts` `applyTags` / `replaceTags` → `enqueue` → `applyOne` (one path; add a `Planner`, not a new path) | invariants below |
| Panel search, groups, formulas, tabs | `formula.ts` / `groups.ts` / `tabs.ts` (pure), then `view.ts`, `dialogs.ts` | user guide §5-7 |
| A setting | `config.ts` (shape, default, `normalizeSettings`), `settings.ts` (row) | user guide §10 |
| The AI assistant guide (`CLAUDE.md` written into a folder) | `guide.ts` (pure), `main.ts` `writeGuide` | user guide §9 |
| Shared DOM bits (keyboard buttons, chip colour, autocomplete) | `ui.ts`: reuse before writing a new one | |

Every change also updates `docs/architecture.md` (module reference, diagrams) when a module's role or a flow changes,
and `docs/user-guide.md` when users see it.

## Invariants (keep them)

1. A file's tags = name tags ∪ frontmatter tags (`.md` only) ∪ sidecar tags, whatever the settings. A folder's
   tags = `tsm.json` tags only.
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

## Tests

- `tests/format.test.ts`: the format, including frontmatter shapes, planning per target, round-trips and refusals, `parseTagInput`.
- `tests/config.test.ts`: `normalizeSettings` on missing / damaged data (naming rule and liaison words included), message texts.
- `tests/naming.test.ts`: the rule (accents, digits, nested), problems, fixes (compounds, elisions, acronyms, nested, no obvious fix), every fix follows the rule, liaison word list, editor input, audit, `replacePlan` (in place, no duplicate), `parseReplacement`, formula / group / tab follow-up.
- `tests/cloud.test.ts`: cloud sizing bounds, log scale, levels, monotonic.
- `tests/colors.test.ts`: automatic colours stable, case / `#` / nested roots, spread over the palette.
- `tests/groups.test.ts`: group operations, multi-membership, no mutation, reorder, loading malformed data, formulas.
- `tests/tabs.test.ts`: tab operations, bookmark once / remove, no mutation, a deleted group leaves the tabs, loading malformed data.
- `tests/formula.test.ts`: syntax (French / English / symbols, precedence, quotes), round-trip, errors, evaluate, prune, case resolution.
- `tests/ui.test.ts`: autocomplete ranking (`matchTags`).
- `tests/guide.test.ts`: guide path and existing-guide detection (any case), tag lists (order, cap), content per
  settings (storage, frontmatter, rule on / off, liaison words), no folder section at the root.
- `tests/smoke.js` + `tests/fixtures/vault/`: ~150 in-app checks. Menus: the plugin's items in one *TagEverything* submenu (fake menus, and the real explorer menu, which proves the internal `setSubmenu` still exists); the editor title, a notice and the panel name start with the plugin's name. The first part runs the name / sidecar engine on
  notes with `noteTagsInFrontmatter = false`; the "notes: frontmatter" part turns it on (merge, no rename on add,
  rename on name-tag removal, new frontmatter block, sidecar → frontmatter, live external edit, invalid YAML
  refused, PDF still renamed, nested tag refused in a name); robustness (a sidecar edit and a folder rename during `rebuild()` are kept, two
  concurrent edits queued, an item deleted since the editor opened refused, editor keeps an invalid word and saves
  once fixed); then panel, badges (a no-op refresh keeps the DOM), settings (declarative rows indexed for search, tab icon; in the
  real settings dialog, the badges toggle disables / enables the two badge options and is saved to `data.json`), tag groups (create through the
  dialog, drag with a synthetic `DataTransfer`, fold, `data.json`, group search, switch a tag off / on; formula through the real menu and dialog: error, preview,
  rendering, search, switch-off pruning, NOT, drop = AND, × prunes; the ⊘ NOT button on group chips, with and without a formula; excluding a cloud tag through its right-click menu, saved state, **+** turning it into a `NOT` formula), panel usability (filter + Enter, keyboard,
  saved state, labelled group search button "Search" / "Stop", group menu starting with it, draggable results, hover source), bookmark tabs (+ creates and shows one,
  bookmark by dropping a tag and a group on the tab and through the tag menu, All unchanged, a tab shows only its bookmarks, `data.json` and panel state, a group
  created in a tab is bookmarked there and leaves it when deleted), modal; naming rule: the editor lower-cases, puts a
  compound's fix in the box (Enter accepts, Save waits), leaves a liaison word out, `applyTags` refuses, settings
  toggle (liaison words disabled, lower-case freed, saved); *Check tag names*: tags planted with the rule off
  (`Tax-Receipt` in a PDF name, `plan_de_charge` / `de` in a frontmatter) plus the fixture's `B27 INC IMAC` are listed
  with their fixes, an invalid edited fix disables Fix, one row unticked, then the fix: case-only rename
  `budget[B27 INC].md` → `budget[b27 inc].md` (Windows), split in the name, frontmatter tag dropped, unticked one kept,
  group formula + `data.json` + panel search follow, a second check lists only what was left; a folder sidecar written with `adapter.write` (no vault event) is found because the check re-reads first, and fixed in its sidecar; the two *Tag maintenance* settings rows (re-read notice, check dialog: both in the settings **window**); the AI assistant guide (folder menu item writes `Projects/CLAUDE.md` with the folder's tags, an edited one is skipped, a lower-case `claude.md` blocks it, the root command writes one without folder section; all deleted after). It ends on the panel, in the bookmark tab "Work", with a formula
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
- Badges rely on internal explorer markup.
- The owner's main vault has *Detect all file extensions* off, so PDFs and Office files are invisible to the plugin
  until they turn it on.
- Inline `#tags` in a note's body are not read (only frontmatter): they can't be removed through a property edit.
- Tag groups don't follow a tag renamed outside the panel (they keep the old name, shown faded); they do follow a
  *Check tag names* fix.
- Naming rule: inline `#tags` in a note body are neither read nor fixed. A nested tag with a multi-word parent level
  has no automatic fix. A tag fixed in a file name on a case-sensitive disk relies on Obsidian's rename (tested on
  Windows only). The liaison word list is a guess: the owner can edit it in the settings.
- Deleting a file in Obsidian leaves its `.ts` sidecar (orphan, ignored by the scan); a file created later with the
  same name would pick its tags up at the next rebuild. Not deleted on purpose (never delete metadata unasked).
- The panel re-renders on every index change even when hidden (cheap: counts are cached and the search runs once per render).
- The AI assistant guide is a snapshot (tag lists, settings) and is never overwritten, so it goes stale: the owner
  deletes and rewrites it. A refresh that rewrites only a marked section of an existing `CLAUDE.md` would fix it, but
  touches a file the owner may have edited (not done: never overwrite).
- Ideas: rename / merge a tag everywhere (the engine exists: `plugin.replaceTags(new Map([[old, [new]]]))`; only a
  UI is missing, e.g. a tag menu item *Rename tag…*); colours editable in settings; tag search in the quick
  switcher; a command to move a note's name tags into its frontmatter (renames the note, so opt-in).
