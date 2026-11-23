# TagEverything: notes for Claude

Read the root `CLAUDE.md` first. Then read **only the sections you need**, found with `grep -n "^## "`: they are big.
`docs/architecture.md` (layers, write path, index, search, module reference), `docs/user-guide.md` (users' view, one
section per feature), `docs/format.md` (storage format spec), `docs/known-limits.md` (limits and ideas, per area).

## What it does

Tags any file or folder of a vault: notes in their frontmatter `tags`, other files in the file name
(`report[tax receipt].pdf`) or in `.ts` sidecar JSON (mostly TagSpaces-compatible); reading merges all three; every
file also carries its extension as a derived, never-written tag. UI, per the root *Four UI surfaces* rule:

- **File explorer**: badges; the **TagEverything explorer** (left sidebar): a tree of tags (inside a tag, the tags
  telling its files apart, then its files), a formula box, a count range, an *Inbox* tab.
- **Context menu** (*TagEverything* submenu): edit tags, suggest tags with Claude Code (read-only `claude -p`),
  apply auto-tag rules, check a folder's tag consistency, exclude from the tag engine, write an AI assistant guide
  (`CLAUDE.md`, never over one).
- **Panel** (right sidebar): *All* (groups = saved searches with formulas, every tag within a count range, extension
  tags only when toggled, and sections holding groups and tags), *Selection* (search by tags AND / NOT and date criteria, narrowing tags, results), *Tools* (vault-wide: re-read, apply
  rules, check tag names, review tags, check tag consistency, suggest better places, rename / merge). The inbox (new untagged files,
  auto-tag rules, tagged files waiting in the inbox folder to be put away) is only the explorer's *Inbox* tab.
- **Settings**: options only. Also: `tag-everything` query blocks in notes (live lists from a formula), a tag naming
  rule (one lower-case plain word) with its audit and fix.

## Where to change what

| Change | Start in | Also update |
|---|---|---|
| How tags are parsed / written in names, sidecars, frontmatter | `format.ts` (pure) | `docs/format.md`; the AI assistant guide text (`guide.ts`), which restates the format for vaults; run `tools/check-vault.ts` |
| Naming rule, fixes, *Check tag names* | `naming.ts` (pure), `fix-modal.ts` | user guide §3-4 |
| Anything that writes tags | `main.ts` `applyTags` / `replaceTags` → `enqueue` → `applyOne` (one path; add a `Planner`, not a new path) | invariants below |
| Panel search, groups, formulas, sections | `formula.ts` / `groups.ts` / `sections.ts` (pure), then `view.ts` (search, tag cloud, tab strip, Selection, section menu items), `panel-groups.ts` (the Groups area: groups, sections, their menus and dialogs), `dialogs.ts` | user guide §5-7 |
| Put away (where a tagged file belongs), bring in (outside folders) | `putaway.ts` / `bring-in.ts` (pure), `putaway-modal.ts`, `bring-in-watcher.ts`, `bring-in-modal.ts`, `main.ts` `moveFiles` / `renameOwn`; menu entry in `menu.ts`, *To put away* in `inbox-pane.ts` `renderPutAway`, *Suggest better places* in `tools-pane.ts`, the list in `settings.ts` | user guide §13 |
| Date criteria (created / modified: panel search, inbox, date terms `created:30d` in formulas, groups, explorer box, query blocks) | `dates.ts` (pure), `formula.ts` (`DateExpr`: parse, format, evaluate), `index.ts` `matches` / `dated`, `dialogs.ts` `dateMenu`, `view.ts` `setDates` / `searchExpr`, `explorer.ts` `setDates`, `inbox.ts` `inboxPaths`, `inbox-pane.ts` | user guide §5, §6, §10, §11, §13 |
| Tag count range (panel All tab, explorer root) | `cloud.ts` (`inCountRange`, `parseBound`), `ui.ts` `countRangeControl`, `view.ts` `countRangeOf` / `setCountRange`, `renderTags`; `explorer.ts` `render` (`keep`) | user guide §5, §10, §14 |
| Inherited tags (folder tags passed down, folder names as tags) and how they are drawn | `inherit.ts` (pure), `index.ts` `computeView` / `setInheritance`, `items.ts` `markInherited`, `styles.css` `.tag-everything-inherited` | user guide §1 |
| A setting | `config.ts` (shape, default, `normalizeSettings`), `settings.ts` (row) | user guide §14 |
| The AI assistant guide (`CLAUDE.md` written into a folder) | `guide.ts` (pure), `main.ts` `writeGuide` | user guide §9 |
| Claude Code suggestions (prompt, flags, answer) | `suggest.ts` (pure), `claude.ts` (process), `suggest-modal.ts`, `main.ts` `suggestTags` / `runClaude` / `addTagsEach` | user guide §9; check a real run by hand (smoke fakes it) |
| The TagEverything explorer (tree nodes, rows, icon) | `explore.ts` (pure), `explorer.ts` | user guide §10 |
| What a file row shows and does (open, preview, drag, file menu): panel, explorer, query blocks, inbox | `items.ts` (`renderItemRow`, `wireItemRow`) | |
| Query blocks (syntax, options, matching, rendering) | `query.ts` (pure), `query-block.ts` | user guide §11 |
| Rename / merge a tag, tag review (look-alikes, synonyms, rare tags) | `taxonomy.ts` (pure), `curator.ts`; writes through `replaceTags` | user guide §12; synonyms prompt or flags changed: one real run (see `docs/known-limits.md`) |
| Tag consistency (a folder's usual tags, the files without them, misspelled ones) | `consistency.ts` (pure), `consistency-modal.ts`, `main.ts` `checkConsistency` / `editEach` | user guide §12 |
| Inbox, auto-tag rules, auto-tag on arrival, inbox folder | `inbox.ts` (pure), `inbox-pane.ts` (`inboxFiles`, the tab count; `InboxPane`, drawn in the explorer's Inbox tab), `rule-modal.ts`, `main.ts` `ruleTagsOf` / `ruleTargets` / `applyRulesTo` / `tagArrivals`; rules list in `settings.ts` | user guide §13 |
| A new action or view | Targeted: an entry in `menu.ts` `fileMenuEntries` / `filesMenuEntries`. Vault-wide: a row in `tools-pane.ts`. Something to browse: a page of the panel (`view.ts` `PanelPage`). An option: `settings.ts`. Never a new sidebar view, ribbon icon or settings action (root `CLAUDE.md`, *Four UI surfaces*) | user guide §5, §14 |
| Exclusions (paths, ignored names with their defaults, rules, what an excluded item is left out of) | `exclude.ts` (pure), `main.ts` `exclusion` / `hasExclusions` / `excludedNamesChanged` / `taggable` / `setExcluded`, `index.ts` `excluded` / `prune`, `badges.ts` (icon) | user guide §13; anything new that lists or writes items without going through the index must check `plugin.isExcluded` |
| Shared DOM bits (keyboard buttons, chip colour, autocomplete) | `ui.ts`: reuse before writing a new one | |

Every change also updates `docs/architecture.md` (module reference, diagrams) when a module's role or a flow changes,
and `docs/user-guide.md` when users see it.

## Invariants (keep them)

1. A file's tags = name tags ∪ frontmatter tags (`.md` only) ∪ sidecar tags, whatever the settings. A folder's
   tags = `tsm.json` tags only. With `extensionTags` (on by default) the file's extension tag comes first in
   `tagsOf`: derived from the name, **never written**. Inherited tags (`inheritFolderTags`, `folderNameTags`, on by
   default; src/inherit.ts) come last in `tagsOf`: computed from the folders, **never written**, always drawn apart
   (`markInherited`); the TagEverything explorer leaves them out unless its toggle `explorerInheritedTags` (off by
   default) is on. What edits or lists stored tags (editor, `replaceTags`, *Check tag names*, the guide's lists,
   rules, inbox, consistency, put away) uses `ownTagsOf` / `counts(paths, true)`.
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
7. Claude Code never writes: for suggestions it gets only the Read, Glob and Grep tools (`--tools`, `dontAsk`), for
   synonyms no tool at all (`--tools ""`); its answer is cleaned (`cleanSuggestions`, `cleanSynonyms`) and written by
   the plugin (`addTagsEach`, `replaceTags`) after the user's review. Started without a shell (no quoting of the
   prompt or the schema), the prompt on stdin.
8. Auto-tagging only adds tags (`addTagsEach`, the usual write path): a rule never removes or renames a tag, and
   runs on a new file only when the user turned `autoApplyRules` on (off by default).
9. An excluded item (src/exclude.ts: by hand, by an ignored name of the settings, or by a rule) is never in the index and never written (`applyOne` throws); excluding or
   including touches only `data.json`, never the item's tags. An excluded path follows its item's renames.

## Tests

Budget first (root `CLAUDE.md`, *Definition of done*): every Obsidian launch costs; targeted unit tests, one smoke run.

Unit tests (`node --test plugins/tag-everything/tests/<file>`), one file per pure module, named after it:
`format`, `config`, `naming`, `cloud`, `colors`, `groups`, `formula`, `ui`, `query`, `taxonomy`,
`exclude`, `inbox`, `explore`, `dates`, `consistency`, `sections`, `putaway`, `bring-in`, `inherit`, `guide` (`.test.ts`). Run the ones of the modules you changed and of those importing them.

`tests/smoke.js` + `tests/fixtures/vault/`: ~330 in-app checks in one script (a run executes them all). Each check
name starts with its area: `file-menu:`, `rebuild:`, `editor:`, `rule:`, `cloud:`, `badges:`, `settings:`,
`groups:`, `panel:`, `formula:`, `NOT:`, `selection tab:`, `formula button:`, `range:`, `fix:`, `command:`,
`guide:`, `suggest:`, `query:`, `rename:`, `review:`, `consistency:`, `put away:`, `bring in:`, `sections:`, `inbox:`, `menu:`, `tools:`, `exclude:`, `exclude rule:`,
`ignore:`, `ext:`, `dates:`, `inherit:`, `explorer:`, `explorer range:`. Find what covers your change with `grep -n 'check("<area>' tests/smoke.js`
and print only those with `--only "<area>"`. Order and state to know: the first part runs the name / sidecar
engine with `noteTagsInFrontmatter` off, then turns it on; the count range is off by default (the fixture's
tags are used once or twice; its section turns it on); extension tags are off for the engine sections and checked in their own section (with the panel's extension toggle
and the panel's date criteria, `dates:`); inherited tags (on by default) are turned off at the start and checked in
their own section (`inherit:`, on a folder of its own, deleted after);
Claude Code is faked (`plugin.runClaude`). It ends with the explorer under `shared AND NOT final` and the panel's
section "Work" holding the group of its formula group search, for the screenshot.

`tests/gallery.js` (`npm run smoke -- tag-everything --script gallery`): not a test, a screenshot of every view and
dialog to `dist/tag-everything-*.png`. One run after a visible change, instead of a smoke run when only the look
changed. Every dialog carries `.tag-everything-dialog` (styles.css *Dialogs*); settings actions are `settings.ts`
`buttonRow` rows.

`tools/check-vault.ts "<vault>"`: **read-only** (folder listings only, OneDrive files stay in the cloud): every
tagged name in a real vault must round-trip unchanged, and name tags breaking the naming rule are listed. Run it
after any change to `parseNameTags` / `setNameTags`.

## Official guidelines

Audited on 2026-11-20 (0.8.0); how to re-run the official linter: root `docs/obsidian-api.md` → *Official
guidelines* (one known false positive: the formula placeholder). Keep: `setCssProps` for computed styles,
`instanceof TFile` (never a cast), `.instanceOf()` for DOM nodes and events (pop-out windows), `async` / `await`.
Deliberate exceptions: `vault.adapter` for `.ts` sidecars (dot-folders are invisible to the Vault API); guarded
internal APIs (explorer `fileItems`, `revealInFolder`, `openWithDefaultApp`, `dragManager`, `getConfig`); no
`normalizePath()` on paths built from vault paths (normalizing again could point at another file);
`isDesktopOnly: true` and an unminified `main.js` (readable stack traces).

## Known limits

In `docs/known-limits.md`, per area: read the entry of what you change, add one when you leave a limit behind.
