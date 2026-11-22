# TagEverything user guide

Tag any file or folder of your vault (notes, PDFs, Office files, images, folders), then find them again by their
tags. This guide covers every feature; the short version is in the [README](../README.md). The exact storage format
is in [format.md](format.md).

## 1. Where your tags are stored

Tags stay in your files, never in a private database, so other tag-aware file managers (TagSpaces) see them too.

```mermaid
flowchart TD
  item{What do you tag?}
  item -->|a folder| tsm["folder/.ts/tsm.json"]
  item -->|a Markdown note| note{Setting: Note tags in frontmatter}
  note -->|on, default| fm["the note's tags property"]
  note -->|off| store
  item -->|any other file| store{Setting: Store file tags in}
  store -->|File name, default| name["report[tax receipt].pdf"]
  store -->|Sidecar| side[".ts/report.pdf.json"]
```

| Item | Where new tags go | Example |
|---|---|---|
| Markdown note, **Note tags in frontmatter** on (default) | The note's `tags` property, as Obsidian stores it. The note is not renamed. | `tags: [b27, proj/alpha]` |
| Other file, **File name** (default) | First `[...]` group of the name, space-separated | `B27_Board_v10[b27 inc].docx` |
| Other file, **Sidecar** | `<folder>/.ts/<file name>.json` → `tags` | `.ts/B27_Board_v10.docx.json` |
| Folder (always) | `<folder>/.ts/tsm.json` → `tags` | `B27/.ts/tsm.json` |

Tags are always **read from every place and merged**: a note's tags are the tags in its name, plus its frontmatter
tags, plus its sidecar tags. A note named `budget[b27 inc].md` with `tags: [q3]` shows `b27 inc q3`. When you edit it,
the name tags you keep stay in the name and new tags go to the frontmatter. Folder names are never read for tags.
**Extension tags** (setting *File extension as a tag*, on by default): every file also carries its extension,
lower-cased, as a tag (`pdf`, `docx`, `md`), shown first. It is read from the name and stored nowhere, so the tag
editor doesn't show it, *Check tag names* ignores it, and the AI assistant guide explains it instead of listing it.
A name with no plain extension (`README`, more than 10 characters, or not only letters and digits) has none.
Other fields of a sidecar or `tsm.json` (id, description, colours…) and other note properties are kept.

## 2. Tag files and folders

- **Right-click → TagEverything → Edit tags** on a file or folder; on a multi-selection, **TagEverything → Edit
  tags of N items**; or the command *Edit tags of the current file*.
- Type a tag and press **Enter**, space or comma. Suggestions come from every tag of the vault, most used first.
- With several items, a tag only some of them carry shows as `3/5`: leave it (those items keep it), click it to give
  it to all, or remove it from all.
- A word that can't be a tag (e.g. `a:b`) stays in the box with the reason, so you can fix it. With the naming rule
  off, a nested tag (`proj/alpha`) works for notes and is refused up front where it can't go (a file name); with the
  rule on, it is split like a compound (section 3).
- For a single file, the dialog previews the **new file name** before you save. Renames go through Obsidian, so
  **links in notes are updated**.
- Tagging more than 5 items shows its progress. If some fail, one notice lists why (the first 5, then how many more).
  Edits run one after the other: a second edit started before the first is written waits for it.

## 3. The tag naming rule

Setting *Tag naming rule*, on by default: a tag is **one lower-case plain word** (letters and digits, accents
allowed), never a liaison word (`de`, `la`, `the`, `of`…; the list is the setting *Liaison words*).

- Typed upper case is lower-cased.
- A compound is refused and its fix put in the box instead: `Tax-Receipt` → `tax receipt` (two tags); press **Enter**
  to accept. `/` splits too, so there are no nested tags: `proj/alpha` → `proj alpha`.
- A liaison word is left out.
- Tags of the vault that break the rule aren't offered as suggestions.

The rule only applies to **new** tags. Existing ones stay until you run *Check tag names*.

## 4. Check tag names (fix the whole vault)

Command *Check tag names (naming rule) and fix them*, or the panel's **Tools** tab → *Check and fix tag names* (Section 5).

1. It re-reads every tag (also those edited outside Obsidian).
2. It lists every tag that breaks the rule: how many items carry it, why, and a suggested fix (`B27` → `b27`,
   `plan_de_charge` → `plan charge`, `proj/alpha` → `proj alpha`, `R&D` → `rd`, `de` → removed).
3. Edit a fix if you want (several tags: separate them with spaces; empty: the tag is removed), untick the ones to
   leave, then **Fix N tags**.
4. Each tag is rewritten **where it is**: in the file name (the file is renamed, links follow), the note's frontmatter
   or the sidecar. Tag groups (formulas included: `Tax-Receipt` becomes `tax AND receipt`), bookmark tabs and the
   panel's search follow.

Run it again to see what is left.

## 5. The TagEverything panel

Open it with the ribbon `tags` icon or the command *Open the tags panel*.

- Every tag with its count; frequently used tags are a little bigger (at most 1.4× the normal size). The tab **All**
  (and each bookmark tab, Section 7) shows only the groups and the tags, two titled sections (*Groups*, then *Tags*
  under a line, with the number of tags shown), using the panel's full height, and always
  every tag with its count in the whole vault, whatever the search: the tags in the search stay in place, highlighted
  (click one to take it out).
- **Click tags** to list the files and folders carrying all of them (AND). The panel then switches to the
  **Selection** tab (at the right end of the tab strip, with the number of items found): the search in a box at the
  top (click a tag there to take it out, **Clear** to stop), then **Narrow**: the tags that can still narrow it, all
  the same size, counted in what it finds (only those on some of the items found, not on all of them: a tag on every
  one would change nothing; click one to add it to the search), then **Results** with their number. **Formula…** (function icon), next to **Clear** on the line under the search, opens the search in the group
  dialog (Section 6) to combine its tags with `OR`, `NOT` and parentheses; saved, it becomes a group and its search
  runs at once. On a group search the button reads **Edit group**. Typing in the filter goes back to the tags. Selection disappears
  once the search is empty.
- **Right-click a tag → Exclude this tag (NOT)** to leave out the items carrying it (shown as `NOT tag`, struck
  through, at the top); right-click it again to search with it instead.
  The same menu has *Rename or merge tag…* (Section 12).
- **Focus on the tags that matter** (All only): the *Tags* heading reads **used [10] to [100] times  See all**. All shows only
  the tags used 10 to 100 times: neither the one-offs nor the tags on almost everything; the count reads *42 of 180*.
  Type other numbers in the boxes: the tags follow as you type, **Enter** or leaving the box saves; an empty second
  box means *no limit*. **See all** shows every tag (the numbers are kept; typing one turns it off again). The tags
  in the search always stay, and typing in the filter finds every tag. Bookmark tabs are not filtered (you chose
  their tags). The TagEverything explorer has the same boxes (Section 10). Default 10–100; also in the settings
  (Section 14).
- **Filter tags**: type, then **Enter** selects the first match, **Escape** clears.
- **Results** work like the file explorer: click to open (Ctrl/Cmd-click or middle-click: new tab; non-note files open
  in their default app, folders are revealed), **Ctrl/Cmd + hover** for a page preview, **drag** one into a note to
  link it, right-click for the usual file menu. A file's extension tag stands in for its icon, before its name, and
  its other tags show below; folders (and files, with extension tags off) keep their icon.
- Everything works from the keyboard (Tab, then Enter or Space). The panel remembers its search, filter and tab
  (Selection included) across restarts.
- The ↻ button re-reads all tags (after editing them outside Obsidian).
- At the right end of the tab strip, two icon tabs: the **inbox** (files without tags, with their number: Section 13)
  and the **Tools** (wrench): the actions on the whole vault, one row each with what it does:
  - *Re-read all tags*;
  - *Apply auto-tag rules*: the button says how many files of the vault the rules would tag (**Apply to N files**);
    rules only add tags. **New rule…** creates one;
  - *Check and fix tag names* (Section 4), *Review tags* and *Rename or merge a tag* (Section 12).

  For chosen files or folders, the same actions are in the right-click menu (*TagEverything →*): see Section 13.

```mermaid
flowchart LR
  g[active group: its formula,<br/>switched-off tags dropped] --> and((AND))
  s[other selected tags] --> and
  x[excluded tags] -->|NOT| and
  and --> r[results and<br/>tag counts]
```

## 6. Tag groups and formulas

Groups keep related tags together and double as saved searches.

- **One dialog** creates and edits a group: its **name**, and what it **searches for**, written as a formula (below),
  with buttons inserting `AND`, `OR`, `NOT`, `(`, `)`. Open it with **+** next to *Groups* (it starts from the
  current search, if any; or drop a tag on **+**), with **Formula…** in the Selection tab (the new group's search
  then runs), or to edit a group with *⋯ → Edit name and formula*, **Edit group** (pencil) during its search, or its formula icon (ƒ in a square) on the group.
  **Drag** any tag onto a group to add it; a tag can be in several groups.
- Groups **fold** (chevron) and reorder by dragging one onto another. **⋯** or right-click: search, edit the name and
  formula, add the selected tags, bookmark, delete (the tags stay on the files).
- Hover a tag of a group: **×** takes it out of the group, **⊘** excludes it from the group's search (`NOT tag`,
  struck through; click ↶ to include it again). Both are also in the tag's right-click menu.
- **A group is a search**: click its **Search** button (it shows how many items the group finds), its name, or
  *⋯ → Search with this group*. The results show in the **Selection** tab. While the search runs, the group's header
  turns to the accent colour and its button reads **→ Selection** with the count: back in All or a bookmark tab, click
  it (or the group's name) to return to the results. In Selection, the group shows at the top as the same card as
  in All (its header in the accent colour, ⋯ for its menu, its tags with their counts, the same hover buttons):
  click a tag to leave it out (dashed, in All too), click again to put it back; click other tags to narrow further. **Clear** there,
  or the group's *⋯ → Stop the search*, stops it.
- **Formulas** (the group dialog's *Searches for*): any combination of tags, e.g. `(b27 OR inc) AND (q3 OR 2026)`.
  - Operators `AND` / `OR` / `NOT`, also `ET` / `OU` / `NON` and `&` / `|` / `!`, and parentheses. Two tags side by
    side mean AND. `NOT` binds first, then `AND`, then `OR`.
  - Tag names complete as you type; the dialog shows the formula as it understood it and how many items it finds, or
    what is wrong.
  - A tag switched off during a group search drops out of its `OR` / `AND` as if it were not written, `NOT x`
    included. Dropping a tag on a group with a formula adds `AND tag`; its × removes it from the formula.
  - What the dialog shows is what the group searches for: tags joined by `AND` alone make a plain group (no formula icon), an
    empty field an empty group. Tags match whatever the case; a tag in quotes may contain a parenthesis or be
    spelled like an operator (`"ou"`).
- Groups are saved in the plugin's settings (`.obsidian/plugins/tag-everything/data.json`), not in your files.

## 7. Bookmark tabs

Under the filter box: a tab **All** (every group and tag), then your own named tabs, e.g. *Work* and *Home*.

- **+** creates a tab (drop a tag or group on **+** to start the tab with it).
- Bookmark a tag or group by **dragging it onto a tab**, or right-click it → **Bookmark in the tab "…"** /
  **Bookmark in a new tab…**. **Remove from the tab "…"** takes it out (the tag stays on your files, the group stays
  in All).
- A tab shows only what is bookmarked in it. A group created with **+** while a tab is shown is bookmarked there.
- Right-click a tab to rename or delete it (deleting a tab deletes nothing else).
- The search is the same whatever the tab, and its results are in the Selection tab (Section 5); the panel reopens on
  the tab you left. Tabs are saved with the groups.

## 8. Colours and explorer badges

- Each tag gets its own colour, picked from its name among the theme colours: always the same in the panel, the
  badges and the editor; nested tags share their parent's colour. A colour stored in a sidecar wins. With 8 colours,
  two tags can share one.
- **Badges**: after a name in the file explorer, a round pill with the **number** of its tags (`report 3`). Hover
  it (or click it) to see the tags, one per line, in their colours; clicking a tag there opens the panel on it.
- The **extension tag** shows **before** the name (`pdf scan[tax].pdf`), not counted in the pill; Obsidian's own
  grey extension label after the name is hidden on those rows. *Badges for: tags not in the name only* keeps it.

## 9. A guide for AI assistants (CLAUDE.md)

An AI coding assistant working in your vault (Claude Code reads `CLAUDE.md` from the folder it starts in and from
its parents) does not know how TagEverything stores tags. Give it a guide:

- **Right-click a folder → TagEverything → Write AI assistant guide**, or the command *Write AI assistant guide in the vault root*.
- It writes `CLAUDE.md` in that folder: where tags live with your current settings, how to read them, the naming rule
  and its liaison words, how to add a tag without breaking anything (sidecar moved along on a rename, links to fix,
  `.ts` files to keep), the tags used in that folder and the most used tags of the vault, so the assistant reuses them.
- A `CLAUDE.md` already there (any case) is **never overwritten**: it is skipped with a notice. To refresh a guide
  (new tags, changed settings), delete it and write it again.
- One guide at the vault root covers every folder; add one in a folder when you want the assistant to see the tags of
  that folder in particular.

### Suggest tags with Claude Code

If [Claude Code](https://claude.com/claude-code) is installed on this computer (and you are logged in to it), it can
read your files and suggest tags for them:

- **Right-click a folder → TagEverything → Suggest tags with Claude Code**: the folder itself and every file under it
  (untagged files first, at most 50 per run). Or right-click a file, or a multi-selection; or the command *Suggest
  tags for the current file with Claude Code*.
- Claude Code works in that folder (for a selection, the closest folder holding all of it). It reads each file (text,
  Markdown, PDF, images; an Office file is judged from its name and its neighbours), looks at the other files of the
  folder for context, and is given **the tags already used in your vault**, so it reuses them rather than inventing
  near-duplicates. It follows the naming rule (Section 3) when it is on, and never repeats a tag the item already has.
- It can only **read**: its tools are limited to reading and searching files. It writes nothing; the plugin writes the
  tags you keep, through the usual path (Section 2: notes in their frontmatter, other files where new tags go).
- A dialog lists each item with its current tags and the suggested ones. **Click a suggested tag to leave it out**;
  a dashed tag is new (no item of the vault has it yet). **Add N tags** writes them; nothing is removed. Closing the
  dialog while Claude Code is still reading stops it.
- It takes a few seconds to a few minutes, and uses your Claude plan (the dialog shows the time and the API price of the
  run, about $0.05 for a few notes). For a large folder, run it on subfolders, or pick a cheaper **Model** in the
  settings (Section 14).

## 10. The TagEverything explorer

Your vault as a **tree of tags**, in the left sidebar next to Obsidian's file explorer (which keeps the folder
view): open it with the ribbon `list-tree` icon or the command *Open the tag explorer*. It looks and indents like the
file explorer.

It has two tabs at the top: **Tags**, the tree described below, and **Inbox**, with the number of files waiting:
the inbox of Section 13, the same as the panel's Inbox tab (rule tags, ✓, dismiss), so you can empty it right next to
your folders. The tab shown is remembered across restarts.

- At the top, a **search box** that takes a formula, as the panel's group formulas do (§6): tags with AND, OR, NOT
  (or ET, OU, NON) and parentheses, e.g. `tax AND NOT receipt`; two tags side by side = AND. While you type a tag,
  the box suggests the vault's tags containing it (with their counts); pick one with the arrows and Enter, or a
  click, and it becomes a **chip** in the box. Keep typing after the chips: a tag (= AND), or `OR tag`, `NOT tag`;
  Enter turns what you typed into chips too. Each chip has a **×** that takes its tag out of the search (Backspace in
  the empty box removes the last one); a `NOT` tag is struck through. The tree then holds **only the items matching
  the formula**, and the line under the box says how many. A tag no item carries is left out (and named, its chip
  faded), so a half-typed tag leaves the tree as it is; an unfinished formula (`tax AND`) says what is missing and
  keeps the last search. Enter also opens the tags every match carries (`tax receipt` → *tax › receipt*); Escape
  clears the box. The search is not remembered across restarts.
- Under the box, **used [10] to [100] times  See all**: the same numbers as the panel's All tab (Section 5), so the root holds
  only the tags used that many times (the line under it reads *12 of 180 tags*). Type other numbers (an empty second
  box: no limit), or **See all** for every tag; it changes the panel too. A tag you opened stays, and while a formula
  is in the box the root holds every tag of what it finds.
- At the root, **every tag**, with the number of items carrying it. Click a tag to open it: inside are the other
  tags that **tell its files apart** (each opening the same way), then its files and folders. Only a tag found on
  **several** of its files, but not on all of them, is a branch:
  - a tag on **one file only** is not a level to click through: that file shows **directly** here;
  - a tag on **every file** of the tag tells nothing apart, so it is not shown: those files show directly too.

  So with `2024[tax].pdf`, `2025[tax receipt].pdf`, `2026[tax receipt].pdf` and `plan[tax plan].md`, *tax* holds the
  branch *receipt* (2 files), then `2024` and `plan` (alone under *plan*); *receipt* holds `2025` and `2026` directly
  (both carry *tax*). One file can show in several places, like a shortcut; its pill lists all its tags.
- Right-click a tag → *Rename or merge tag…* (Section 12).
- Extension tags (`pdf`, `md`) are not branches: every file has one. They stay as the badge before the file name.
- A file row is its extension badge and its name, then on the right the round **pill** with the number of its tags
  (hover it: the list) and a **folder icon**: hover it to see the folder the file is really in, click it to show the
  file there in the file explorer. Right-click → *TagEverything → Show in the file explorer* does the same (also on
  the panel's results).
- It shows **every file**, even those Obsidian's explorer hides while *Detect all file extensions* is off (Office
  files and other types Obsidian can't open); right-click → *TagEverything → Edit tags* tags them. Shown in the file
  explorer, such a file only opens its folder there, since the file explorer hides it.
- The file open in the editor is highlighted wherever it shows. The button at the top closes every tag; open tags
  are remembered across restarts.

```mermaid
flowchart LR
  root[All tags] --> tax[tax]
  root --> receipt[receipt]
  tax --> tr["receipt (2)"]
  tr --> f2["2025[tax receipt].pdf"]
  tr --> f3["2026[tax receipt].pdf"]
  tax --> f1["2024[tax].pdf"]
  tax --> fp["plan[tax plan].md"]
  receipt --> f2b["2025[tax receipt].pdf"]
  receipt --> f3b["2026[tax receipt].pdf"]
```

Files behave as in the panel's results: click to open (Ctrl/Cmd-click or middle-click: new tab; non-note files in
their default app; a tagged folder is shown in the file explorer), Ctrl/Cmd + hover for a preview, drag into a note
to link it, right-click for the file menu. A tag lists at most 500 files.

Above the tags, an **Inbox** node holds the files of the inbox (Section 13: no tag, arrived lately, in the inbox
folder if one is set), newest first, while the search box is empty.

## 11. Query blocks: live lists in your notes

A `tag-everything` code block in any note lists, live, the files and folders matching a tag formula (the formula
syntax of Section 6), PDFs and Office files included. A project note can so gather its documents without a single
link to maintain.

```markdown
```tag-everything
// what this block is for (optional comment)
(invoice OR facture) AND 2025 AND NOT paid
sort: modified
limit: 20
```
```

- Every line that is not an option or a `//` comment is part of the formula; two lines side by side mean AND.
- Options, each on its own line: `sort: name` (default, as the file explorer), `modified` or `created` (newest
  first); `limit: 1` to `500` (default 50: the block then says how many more there are).
- The block shows the formula as chips (click one: the panel searches that tag), how many items match, then the items
  like the panel's results: click to open, Ctrl/Cmd + hover for a preview, drag into a note, right-click for the file
  menu.
- Extension tags work too: `pdf AND tax` lists the tax PDFs.
- It follows the vault as it changes: tags edited, files renamed or deleted.
- A tag no item carries is shown faded and named under the formula ("No item carries …"): it finds nothing (and
  `NOT` that tag finds everything), unlike the panel, which leaves an unknown tag out. A formula that doesn't parse
  shows why, with the syntax.
- Command *Insert a tag query block*: inserts a block at the cursor, with the selected text as its formula, else the
  formula in the TagEverything explorer's search box (Section 10), else an empty line to type it on.
- Only items with a tag are found (with *File extension as a tag* on, that is every file).

## 12. Rename, merge and review tags

### Rename or merge a tag

Right-click a tag in the panel or in the TagEverything explorer → **Rename or merge tag…**, or the command *Rename
or merge a tag* (pick the tag first). Type what the tag becomes; the dialog says what will happen before anything
changes:

| You type | It does |
|---|---|
| a new name | **Rename**: the tag becomes it on every item |
| a tag the vault already has | **Merge**: its items get that tag; an item carrying both keeps one |
| several words | **Split**: the tag becomes all of them |
| nothing | **Remove**: the tag is taken off every item |

The tag is rewritten where it is on each item (file name, note frontmatter, sidecar), exactly like *Check tag names*
(Section 4): files whose name holds it are renamed (links follow), tag groups and bookmark tabs follow. With the naming
rule on, the new name must follow it.

### Review tags

Command *Review tags (look-alikes, synonyms, used once)*, or the panel's **Tools** tab → *Review tags*. It re-reads
every tag, then lists:

- **Look-alike tags**, found on your computer, free: the same word once case, accents and a plural s / x are ignored
  (`facture`, `Factures`, `facturé`: ticked, they are the same word), or a one-letter typo or swap (`reciept`,
  `receipt`: not ticked, `livre` and `libre` are two words). Short words (under 5 letters) and tags with digits are
  never called typos (`q1` / `q2`, `2024` / `2025`). Each group merges into its most used tag.
- **Synonyms**, on demand: **Find synonyms with Claude Code** sends your tag list (with the counts, not your files;
  Claude Code gets no tool at all, so it reads and changes nothing) and lists the groups of tags that mean the same
  thing: `banque` and `bancaire`, `invoice` and `facture`. They are not ticked: check them. It takes a few seconds
  (with the *haiku* model, well under a cent for a few hundred tags). See Section 9 for installing Claude Code.
- **Used on one item only** (folded): often a typo, or a tag never reused; each row says which item carries it.
  Tick one and leave the box empty to remove the tag, or type the tag to merge it into.

Edit the tag to keep in any row (several: separate with spaces; empty: removed), tick what to change, then
**Change N tags**: everything is rewritten in one pass, as above. A tag ticked in two rows with different targets is
refused (the dialog says which); chains are followed (`a` → `b` and `b` → `c`: `a` becomes `c`).

## 13. The inbox and auto-tag rules

The inbox lists the files **without tags that arrived lately** (created in the vault in the last 30 days, setting
*Days in the inbox*), newest first. It is a tab of the TagEverything panel: the `inbox` icon at the right end of its
tab strip, with the number of files waiting; or the command *Open the inbox (files without tags)*. A file leaves the
inbox as soon as it has a tag.

- **Focus on one folder**: right-click the folder → *TagEverything → Inbox of this folder*, or *Settings → Inbox →
  Inbox folder* (e.g. `Downloads/Scans`, subfolders included; case and accents ignored; empty = the whole vault). The
  inbox then lists only the files there and says so at the top; its **Whole vault** button stops the focus. Rules and
  *Tag new files with the rules automatically* still work everywhere.
- **In the TagEverything explorer** (Section 10): the same inbox is its **Inbox** tab, next to *Tags*, with the
  number of files waiting; everything below works there too.

- Each row: the file (click to open, right-click for the file menu, as in the panel), its folder, when it arrived, and
  the tags your **rules** would add (dashed; click one to leave it out). On the right: **✓** adds those tags, the tag
  icon opens the tag editor, the wand creates a rule from this file (its folder and extension filled in), **×**
  dismisses it (no tag needed; *Settings → Show dismissed files again* brings them back).
- At the top: **Apply rules to N files** adds every row's rule tags at once; **Suggest tags** asks Claude Code for
  tags for the newest 50 (Section 9); **New rule** creates a rule.

**Auto-tag rules**: "a file in this folder, whose name contains one of these words, with one of these extensions,
gets these tags". Each condition is optional, but a rule needs at least one. Names are compared without case or
accents, and without the tags already in the name. The rule dialog says how many files of the vault it matches, and
how many of them have no tag yet. Rules are listed in *Settings → Auto-tag rules*: click one to edit it, **+** adds
one, the bin deletes one.

**Apply the rules to existing files**: right-click a file, a folder (every file below it) or a selection →
*TagEverything → Apply auto-tag rules (N files)*; the item shows only when a rule would add a tag there. For the whole
vault: the panel's **Tools** tab → *Apply auto-tag rules*. Rules only add tags, never remove or rename one.

Setting **Tag new files with the rules automatically** (off by default): a file created in the vault (a download, a
scan, a copy) gets its rule tags at once, 2 seconds after the last of a burst of new files, without going through
the inbox; one notice says what was tagged. Tags go where new tags go (Section 1): a PDF is renamed
(`Facture EDF[energie].pdf`) with the default settings.

### Exclude files and folders from the tag engine

Right-click a file or folder → **TagEverything → Exclude from the tag engine** (or a selection: *Exclude N items*).
TagEverything then ignores it everywhere: no badge, not in the panel, the explorer, query blocks or tag counts, not in
the inbox, never auto-tagged, suggested for or written to. Its tags stay on disk as they are (name, frontmatter,
sidecar) and come back as soon as it is included again. A folder takes everything under it.

- In the file explorer, an excluded item shows an **eye-off** icon after its name and is faded (even with the badges
  off); hover the icon to see why (the item itself, a folder above it, or a rule).
- Its right-click menu then offers only the way back: **Include in the tag engine again**, *Include "folder" …* when a
  folder above it is excluded, or *Excluded by the rule "…": edit it*. Edit tags on it says it is excluded.
- An excluded item renamed or moved in Obsidian stays excluded.
- **Exclusion rules** (*Settings → Exclusion rules*, **+**): the conditions of the auto-tag rules (folder, words of
  the name, extensions) without tags; the dialog says how many files of the vault the rule excludes. A rule with only
  a folder also excludes that folder and every folder inside it.
- *Settings → Excluded from the tag engine* lists what you excluded by hand; the bin includes it again.

## 14. Commands and settings

| Command | What it does |
|---|---|
| Edit tags of the current file | Opens the tag editor on the active file |
| Open the tags panel | Shows the panel in the right sidebar |
| Open the tag explorer (a tree of tags) | Section 10: shows the TagEverything explorer in the left sidebar |
| Check tag names (naming rule) and fix them | Section 4 |
| Re-read all tags (after editing them outside Obsidian) | Rebuilds the tag index and says how many items are tagged |
| Open the tag tools (re-read, rules, check, review) | Section 5: the panel's Tools tab |
| Write AI assistant guide in the vault root | Section 9 (folders: right-click → *TagEverything → Write AI assistant guide*) |
| Suggest tags for the current file with Claude Code | Section 9 (folders, selections: right-click → *TagEverything → Suggest tags with Claude Code*) |
| Insert a tag query block | Section 11 |
| Rename or merge a tag | Section 12 (also right-click a tag in the panel or the explorer) |
| Review tags (look-alikes, synonyms, used once) | Section 12 |
| Open the inbox (files without tags) | Section 13: the panel's Inbox tab |

| Setting | Default | Effect |
|---|---|---|
| Store file tags in | File name | Where new tags of non-note files go: the name, or a `.ts` sidecar |
| Note tags in frontmatter | On | New tags of a note go to its `tags` property; the note is not renamed |
| Tag naming rule | On | Section 3 |
| Liaison words | French + English list | Words never used as tags while the rule is on; empty the box to restore the list |
| Lower-case new tags | Off | Only used while the naming rule is off (the rule implies it) |
| Move .ts metadata with renamed files | On | A file renamed or moved in Obsidian takes its sidecar and thumbnail along |
| File extension as a tag | On | Section 1: every file carries its extension as a tag, shown before its name in the explorer |
| Colour tags automatically | On | Section 8 |
| Tags panel: *Only tags used a number of times* / *Used at least* / *Used at most* | On / 10 / 100 | Sections 5 and 10: the panel's All tab and the explorer's root show only the tags used that many times (*at most* 0: no limit); their boxes and *See all* change the same values |
| Show tag badges / Badges for | On / All tags | Explorer badges (Section 8); *Badges for* leaves out of the count and the list the tags already readable in the name |
| Claude Code program | empty | For *Suggest tags with Claude Code* (Section 9). Empty: `claude` on the PATH, then `~/.local/bin`; otherwise the full path of `claude.exe` |
| Model | empty | The model that suggests tags and synonyms (`sonnet`, `haiku`: cheaper for many files). Empty: Claude Code's own default |
| Inbox | | *Open the inbox*; *Days in the inbox* (30); *Inbox folder* (empty: the whole vault); *Tag new files with the rules automatically* (off); *Show dismissed files again* (Section 13) |
| Auto-tag rules | none | Section 13: click to edit, **+** to add, the bin to delete |
| Excluded from the tag engine | none | Section 13: the files and folders excluded by right-click; the bin includes one again |
| Exclusion rules | none | Section 13: click to edit, **+** to add, the bin to delete |
| Tag maintenance | | *Tag tools*: opens the panel's Tools tab, where the actions are (Section 5) |

Everything the plugin adds says so: its context-menu items are under one **TagEverything** submenu, its commands
read *TagEverything: …* in the command palette, its notices start with *TagEverything:*, and its panel, explorer
and dialogs are titled *TagEverything*. It lives in four places only: the explorers (Obsidian's, with its badges, and
the TagEverything explorer), the right-click menu (actions on chosen items), the panel (tags, search, inbox, tools)
and the settings (options).

The settings also show up in Obsidian's settings search (e.g. type "badges" or "sidecar").

## 15. Limits and troubleshooting

- **Office files (and other types Obsidian can't open) don't show in the file explorer**: Obsidian loads them but its
  explorer hides them while *Settings → Files and links → Detect all file extensions* is off. The TagEverything
  explorer (Section 10) and the panel show them, and tag them, either way; turn the setting on to see them in
  Obsidian's explorer too.
- **Tags changed in another app don't show**: Obsidian does not watch `.ts` folders. Use *Re-read all tags* (panel ↻,
  its Tools tab or the command), or *Check tag names* (it re-reads first); it also happens at each start. Name and frontmatter
  tags update live.
- **No badges**: they use the explorer's internal markup (no public API); an Obsidian update may hide them. Everything
  else keeps working.
- A file name is capped at 255 characters: tagging that would exceed it is refused. Tags cannot contain spaces or
  `[ ] # ^ | \ / : * ? " < >` (`/` is allowed for notes, as a nested tag).
- Only frontmatter tags of a note are read, not `#tags` written in its text (they are not checked by the naming rule
  either).
- A note whose frontmatter isn't valid YAML is left untouched: fix it in Obsidian first.
- Tags in a note's frontmatter aren't visible to other tag-aware file managers. Turn *Note tags in frontmatter* off
  to tag notes the same way as other files.
- Deleting a file in Obsidian leaves its `.ts` sidecar in place (metadata is never deleted unasked).
- Tag groups don't follow a tag renamed outside the plugin (they keep the old name, shown faded); they do follow a
  *Check tag names* fix, a rename / merge and a review.
- Query blocks don't follow a renamed tag: edit the formula (the block names the tag no item carries any more).
- The inbox and the auto-tag rules go by the date a file was **created in the vault**: a file moved in from another
  folder of the vault is not new. A dismissed file that is renamed comes back.
- Auto-tagging renames a new PDF or Office file when its tags go in the file name: if another app still writes the
  file, the rename can fail (the notice says so); it is then in the inbox, with its rule tags one click away.
- **Claude Code was not found**: install it, or set the full path of `claude.exe` in *Claude Code program* (an npm
  `claude.cmd` cannot be started directly: point to the `.exe`). **Not logged in / other errors**: the dialog shows
  Claude Code's message; run `claude` once in a terminal to log in. Its suggestions are only suggestions: check them.
