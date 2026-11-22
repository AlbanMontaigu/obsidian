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
   or the sidecar. Tag groups (formulas included: `Tax-Receipt` becomes `tax AND receipt`), sections and the
   panel's search follow.

Run it again to see what is left.

## 5. The TagEverything panel

Open it with the ribbon `tags` icon or the command *Open the tags panel*.

- Every tag with its count; frequently used tags are a little bigger (at most 1.4× the normal size). The tab **All**
  shows only the groups (with their sections, Section 7) and the tags, two titled parts (*Groups*, then *Tags*
  under a line, with the number of tags shown), using the panel's full height, and always
  every tag with its count in the whole vault, whatever the search: the tags in the search stay in place, highlighted
  (click one to take it out).
- **Click tags** to list the files and folders carrying all of them (AND). The panel then switches to the
  **Selection** tab (at the right end of the tab strip, with the number of items found): the search in a box at the
  top (click a tag there to take it out, **Clear** to stop), then **Narrow**: the tags that can still narrow it, all
  the same size, counted in what it finds (only those on some of the items found, not on all of them: a tag on every
  one would change nothing; click one to add it to the search), then **Results** with their number. **Formula…** (function icon), next to **Clear** on the line under the search, opens the search as a formula
  (Section 6), no name needed, to combine its tags with `OR`, `NOT` and parentheses; **Search** runs it: its plain
  tags, `NOT` tags and dates show as the usual chips, the rest (the `OR`s, the parentheses) as one chip with the
  function icon (click it to take it out; **Formula…** again to edit it). Nothing is saved: **Save as group**
  next to it saves the search as a group (a name, then the group's search runs). A search that finds nothing says so. On a group search the button reads
  **Edit group**. Typing in the filter goes back to the tags. Selection disappears
  once the search is empty.
- **Dates**: the **calendar** icon next to the filter box picks a date for the search: **Created** or **Modified**,
  *in the last day / 7 days / 30 days / 90 days / year* (recent) or *more than 30 days / 90 days / a year ago* (old),
  or *Any date*. Both can be set at once (e.g. created more than a year ago, modified in the last 7 days). With tags,
  the search keeps only the files carrying them that meet the dates (`invoice` + *modified in the last 7 days*); alone,
  a date lists every file that meets it. The dates show in the search as chips with a calendar icon (click one to take
  it out), the icon turns to the accent colour, and they stay when you click other tags or a group; **Clear** removes
  them too. Folders have no date: a date search leaves them out. **Formula…** writes them into the new group's formula
  (`created:1d`, Section 6), so a group can keep them.
- **Right-click a tag → Exclude this tag (NOT)** to leave out the items carrying it (shown as `NOT tag`, struck
  through, at the top); right-click it again to search with it instead.
  The same menu has *Rename or merge tag…* (Section 12).
- **Focus on the tags that matter** (All only): the *Tags* heading reads **used [10] to [100] times  See all**. Off at
  first (**See all** pressed: every tag shows, the count reads *180 tags*); once the vault has many tags, type numbers
  in the boxes and All shows only the tags used that many times, neither the one-offs nor the tags on almost
  everything; the count reads *42 of 180 tags*. The tags follow as you type, **Enter** or leaving the box saves; an
  empty second box means *no limit*. **See all** shows every tag again (the numbers are kept; typing one turns the
  range on again). If no tag is in the range, All says so. The tags
  in the search always stay, and typing in the filter finds every tag. The tags of a section are not filtered (you
  put them there). The TagEverything explorer has the same boxes (Section 10). Default off, with 10–100 in the boxes; also in
  the settings (Section 14).
- **Extension tags** (`pdf`, `md`, Section 1) are hidden from the tag lists (All, Narrow) by default: the **file type**
  icon in the *Tags* heading (All) shows them, click again to hide them; remembered. They still work everywhere else:
  in formulas, in the explorer, as the badge before a result's name, and a badge click searches with one.
- **Filter tags**: type, then **Enter** selects the first match, **Escape** clears.
- **Results** work like the file explorer: click to open (Ctrl/Cmd-click or middle-click: new tab; non-note files open
  in their default app, folders are revealed), **Ctrl/Cmd + hover** for a page preview, **drag** one into a note to
  link it, right-click for the usual file menu. A file's extension tag stands in for its icon, before its name, and
  its other tags show below; folders (and files, with extension tags off) keep their icon.
- Everything works from the keyboard (Tab, then Enter or Space). The panel remembers its search, filter and tab
  (Selection included) across restarts.
- The ↻ button re-reads all tags (after editing them outside Obsidian).
- At the right end of the tab strip, an icon tab: the **Tools** (wrench): the actions on the whole vault, one row each
  with what it does (the inbox is in the TagEverything explorer: Section 13):
  - *Re-read all tags*;
  - *Apply auto-tag rules*: the button says how many files of the vault the rules would tag (**Apply to N files**);
    rules only add tags. **New rule…** creates one;
  - *Check and fix tag names* (Section 4), *Review tags*, *Check tag consistency* and *Rename or merge a tag*
    (Section 12);
  - *Suggest better places*: the filed files whose tags fit another folder better (Section 13, *Put files away*).

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
  current search, if any; or drop a tag on **+**), with the **folder-plus** icon of the Selection tab (the new
  group's search then runs; **Formula…** there edits the search alone, without a name), or to edit a group with *⋯ → Edit name and formula*, **Edit group** (pencil) during its search, or its formula icon (ƒ in a square) on the group.
  **Drag** any tag onto a group to add it; a tag can be in several groups.
- Groups **fold** (chevron) and reorder by dragging one onto another. **⋯** or right-click: search, edit the name and
  formula, add the selected tags, move to a section (Section 7), delete (the tags stay on the files).
- Hover a tag of a group: **×** takes it out of the group, **⊘** excludes it from the group's search (`NOT tag`,
  struck through; click ↶ to include it again). Both are also in the tag's right-click menu.
- **A group is a search**: click its **Search** button (it shows how many items the group finds), its name, or
  *⋯ → Search with this group*. The results show in the **Selection** tab. While the search runs, the group's header
  turns to the accent colour and its button reads **→ Selection** with the count: back in All, click
  it (or the group's name) to return to the results. In Selection, the group shows at the top as the same card as
  in All (its header in the accent colour, ⋯ for its menu, its tags with their counts, the same hover buttons):
  click a tag to leave it out (dashed, in All too), click again to put it back; click other tags to narrow further. **Clear** there,
  or the group's *⋯ → Stop the search*, stops it.
- **Formulas** (the group dialog's *Searches for*): any combination of tags, e.g. `(b27 OR inc) AND (q3 OR 2026)`.
  - Operators `AND` / `OR` / `NOT`, also `ET` / `OU` / `NON` and `&` / `|` / `!`, and parentheses. Two tags side by
    side mean AND. `NOT` binds first, then `AND`, then `OR`.
  - **Dates**: `created:30d` = created in the last 30 days, `modified:>1y` = modified more than a year ago. Units
    `d` (days, the default), `w` (weeks), `m` (30 days), `y` (years); `>` means older than; also `créé:` /
    `modifié:`. They combine like tags: `invoice AND created:>1y`, `(tax OR bank) modified:7d`, `NOT modified:90d`.
    The dialog's **Date** button inserts one from the same menu as the panel's calendar. A folder has no date: a date
    term never matches it. A tag really spelled like a date term goes in quotes (`"created:30d"`).
  - Tag names complete as you type; the dialog shows the formula as it understood it and how many items it finds, or
    what is wrong.
  - A tag switched off during a group search drops out of its `OR` / `AND` as if it were not written, `NOT x`
    included. Dropping a tag on a group with a formula adds `AND tag`; its × removes it from the formula.
  - What the dialog shows is what the group searches for: tags joined by `AND` alone make a plain group (no formula icon), an
    empty field an empty group. Tags match whatever the case; a tag in quotes may contain a parenthesis or be
    spelled like an operator (`"ou"`).
  - A group's date terms show in its card as chips in words (*created in the last 30 days*); their × takes one
    out. A group with dates of its own replaces the panel's dates while it searches.
- Groups are saved in the plugin's settings (`.obsidian/plugins/tag-everything/data.json`), not in your files.

## 7. Sections

In All, groups and tags can be sorted under your own **sections**, e.g. *Work* and *Home*: foldable headings under
the groups that are in no section.

- The **folder-plus** icon next to **+** in the *Groups* heading creates a section (drop a tag or group on it to start
  the section with it).
- Move a group or tag into a section by **dragging it onto the section**, or right-click it (a group: its **⋯**) →
  **Move to the section "…"** / **Move to a new section…**. A group or tag is in one section at most: moving it takes
  it out of the other. **Take out of the section "…"** puts a group back at the top. A group dropped on a group of a
  section joins that section, before it.
- A section shows its groups, then its tags (with their counts, a click searches with one, as in *Tags*). A tag in a
  section is still in the *Tags* list.
- Click a section's heading to fold or unfold it. Its **⋯** (or right-click): *New group in this section…*, *Rename
  section*, *Delete section* (its groups and tags stay, back at the top; nothing else is deleted).
- Sections are saved with the groups. The bookmark tabs of 0.36 and before became sections (a group or tag that was in
  several tabs stays in the first one).

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

- **Right-click a folder → TagEverything → Write a guide for AI assistants (CLAUDE.md)**, or the command *Write a guide
  for AI assistants (CLAUDE.md) in the vault root*.
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
the inbox of Section 13 (rule tags, the ⋮ menu of actions), so you can empty it right next to your folders. The tab shown is remembered across restarts.

- At the top, a **search box** that takes a formula, as the panel's group formulas do (§6): tags with AND, OR, NOT
  (or ET, OU, NON) and parentheses, e.g. `tax AND NOT receipt`; two tags side by side = AND. While you type a tag,
  the box suggests the vault's tags containing it (with their counts); pick one with the arrows and Enter, or a
  click, and it becomes a **chip** in the box. Keep typing after the chips: a tag (= AND), or `OR tag`, `NOT tag`;
  Enter turns what you typed into chips too. Each chip has a **×** that takes its tag out of the search (Backspace in
  the empty box removes the last one); a `NOT` tag is struck through. The tree then holds **only the items matching
  the formula**, and the line under the box says how many. A tag no item carries is left out (and named, its chip
  faded), so a half-typed tag leaves the tree as it is; an unfinished formula (`tax AND`) says what is missing and
  keeps the last search. **Dates** work as in group formulas (§6): type `created:30d` or `modified:>1y`, or pick
  one with the **calendar** icon next to the box (the same menu as the panel's; it replaces the box's dates); each is
  a chip with a × (*created in the last 30 days*), and the icon turns to the accent colour. Enter also opens the tags every match carries (`tax receipt` → *tax › receipt*); Escape
  clears the box. The search is not remembered across restarts.
- Under the box, **used [10] to [100] times  See all**: the same numbers as the panel's All tab (Section 5); once the
  range is on, the root holds only the tags used that many times (the line under it reads *12 of 180 tags*, and says
  so when none is in the range). Type other numbers (an empty second
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

- Every line that is not an option or a `//` comment is part of the formula; two lines side by side mean AND. Date
  terms (Section 6) work too: a line `modified:7d` lists only what changed in the last 7 days.
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
(Section 4): files whose name holds it are renamed (links follow), tag groups and sections follow. With the naming
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

### Check tag consistency

The files of one folder often share a tag: every PDF of *Bills* carries `invoice`. The few that don't are worth a
look: forgotten, misspelled, or a real exception. Right-click a folder → **TagEverything → Check tag consistency**
(that folder and its subfolders), the panel's **Tools** tab → *Check tag consistency* (the whole vault), or the
command of the same name. It re-reads every tag, then lists, folder by folder:

- **A file missing its folder's usual tag**. A tag is usual in a folder when at least 3 of the files directly in it
  and at least ¾ of them carry it. The files of one type are also a group of their own (the PDFs of a folder can
  share a tag its notes don't). An untagged file of the folder is listed too. Each row says how many files carry
  the tag: *6 of the 8 files here carry invoice*.
- **A misspelled tag**: a file carrying a look-alike of the usual tag (`invoices` for `invoice`, `reciept` for
  `receipt`, same rule as *Review tags*) gets it replaced.

Files that are different on purpose stay out: when two or more files of the folder share another tag and none of
them has the usual one (`2025` files in a folder of `2024` ones), they are a group of their own, not mistakes. A
lone file with `2025` is still listed: leave it unticked.

Nothing is ticked: tick the rows to fix (or **Tick all**), then **Fix N files**. Tags are only added, except the
misspelled one a row replaces. A usual tag breaking the naming rule cannot be added: fix it first with *Check tag
names*. At most 500 rows are listed; for a folder with more, an auto-tag rule (Section 13) fixes them at once.

## 13. The inbox and auto-tag rules

The inbox lists the files **without tags that arrived lately** (created in the vault in the last 30 days, setting
*Days in the inbox*), newest first. It is the **Inbox** tab of the TagEverything explorer (Section 10), next to
*Tags*, with the number of files waiting; or the command *Open the inbox (files without tags)*, which opens the explorer
on it. A file leaves the inbox as soon as it has a tag.

- **Focus on one folder**: right-click the folder → *TagEverything → Show the inbox of this folder*, or *Settings → Inbox →
  Inbox folder* (e.g. `Downloads/Scans`, subfolders included; case and accents ignored; empty = the whole vault). The
  inbox then lists only the files there and says so at the top; its **Whole vault** button stops the focus. Rules and
  *Tag new files with the rules automatically* still work everywhere.

- Each row: the file (click to open, right-click for the file menu, as in the panel), its folder, when it arrived, and
  the tags your **rules** would add (dashed; click one to leave it out). On the right, one **⋮** icon opens its
  actions: *Add the rule tags* (named; only when there are some), *Edit tags…*, *Suggest tags with Claude Code…*
  (Section 9), *New rule from this file…* (its folder and extension filled in), *Dismiss: no tag needed*
  (*Settings → Show dismissed files again* brings them back).
- At the top: **Apply rules to N files** adds every row's rule tags at once; **Suggest tags** asks Claude Code for
  tags for the newest 50 (Section 9); **Dates** picks date criteria as in the panel (Section 5); **New rule** creates a rule.
- **Dates**: *Created* replaces the *Days in the inbox* window, so *Created → More than a year ago* lists the old
  untagged files; *Modified* narrows the list further (rows then also say when the file was modified). The line at
  the top and the tab's count follow; **Any date** goes back to the settings' window. Not remembered across restarts.

**Auto-tag rules**: "a file in this folder, whose name contains one of these words, with one of these extensions,
gets these tags". Each condition is optional, but a rule needs at least one. Names are compared without case or
accents, and without the tags already in the name. The rule dialog says how many files of the vault it matches, and
how many of them have no tag yet. Rules are listed in *Settings → Auto-tag rules*: click one to edit it, **+** adds
one, the bin deletes one.

**Apply the rules to existing files**: right-click a file, a folder (every file below it) or a selection →
*TagEverything → Apply auto-tag rules (N files)*; the item shows only when a rule would add a tag there. For the whole
vault: the panel's **Tools** tab → *Apply auto-tag rules*. Rules only add tags, never remove or rename one.

**To put away**: below the untagged files, the inbox lists the files **with** tags still waiting in the inbox folder
(*Settings → Inbox → Inbox folder*, e.g. `0. Inbox`) or in a folder that receives outside files (below), each with
the folder it fits (*→ Bills/Power*, see *Put files away*). **Put away N files…** opens the put-away dialog on them;
nothing moves before you click *Move* there, so a file stays in the inbox folder until you file it. The files there
that fit no folder yet are counted below the list: move one by hand, and once a folder holds 2 files with the same
tags, the others are offered. With no inbox folder and no outside folder set, this part does not show.

Setting **Tag new files with the rules automatically** (off by default): a file created in the vault (a download, a
scan, a copy) gets its rule tags at once, 2 seconds after the last of a burst of new files, without going through
the inbox; one notice says what was tagged. Tags go where new tags go (Section 1): a PDF is renamed
(`Facture EDF[energie].pdf`) with the default settings.

### Put files away

Once a file has tags, TagEverything can move it to the folder where files with the same tags already are: right-click
a file, a folder (every file below it) or a selection → *TagEverything → Put away in the usual folder (N files)*. The item shows only
when some file there has a better folder to go to.

- A folder's **usual tags** are the tags most of its own tagged files carry (at least 2 files and 3 in 4 of them; its
  subfolders' files don't count, untagged files neither). A folder fits a file when the file carries **all** its
  usual tags: `Bills/Power` (usually `bill`, `power`) fits `new[bill power 2026].pdf`.
- The dialog lists each file, ticked, with the best folder (the one with the most usual tags matched, then the
  biggest) and why (*Its 3 files usually carry bill, power*); the list offers up to 3 folders. Untick a file to
  leave it. **Move N files** moves the ticked ones; links to them follow, and so do their `.ts` sidecars.
- A file already in a folder that fits it as well as any other is left out. The inbox folder and the folders that
  receive outside files (below), with their subfolders, are never offered: files only pass through them.
- The files waiting in the inbox folder are listed in the inbox (*To put away*, above).
- **Suggest better places** (panel's **Tools** tab): the same for the whole vault, outside the inbox folder and the
  folders receiving outside files: the files already filed somewhere whose tags fit another folder better. The
  dialog opens with **nothing ticked**, since those files were put there on purpose: tick the moves you agree with.
- A file is never moved over another: a name already taken in the folder is refused, listed in one notice, and both
  files stay as they are.

### Bring in files from outside the vault

Downloads and scans land outside the vault. *Settings → Bring in files from outside the vault* → **+** adds a folder
of your computer (e.g. `C:\Users\me\Downloads`), the vault folder its files go to (default `Inbox`, created if
needed) and, optionally, the extensions wanted (`pdf jpg`; empty = any file).

- Every file that **arrives** there afterwards is moved into the vault folder (copied, never over a file, then removed
  outside): while Obsidian is open, about 2 seconds after it is written; the files that arrived while Obsidian was
  closed, when it starts. The files already in the folder when you added it stay there.
- A brought-in file is a new file of the vault: it waits in the inbox, and gets its rule tags at once when *Tag new
  files with the rules automatically* is on. Then *Put away* files it.
- Downloads in progress (`.crdownload`, `.part`, `.tmp`…), hidden files, Office lock files (`~$…`) and subfolders
  are left alone. A name already taken in the vault folder is refused (one notice per file and session); the file
  stays outside.
- One notice says what came in (*TagEverything: 2 files brought in from Downloads to Inbox: …*). Click a folder in
  the list to edit it, the bin to stop watching it. The dialog refuses a folder that is inside the vault.

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
| Write a guide for AI assistants (CLAUDE.md) in the vault root | Section 9 (folders: right-click → *TagEverything → Write a guide for AI assistants (CLAUDE.md)*) |
| Suggest tags for the current file with Claude Code | Section 9 (folders, selections: right-click → *TagEverything → Suggest tags with Claude Code*) |
| Insert a tag query block | Section 11 |
| Rename or merge a tag | Section 12 (also right-click a tag in the panel or the explorer) |
| Review tags (look-alikes, synonyms, used once) | Section 12 |
| Check tag consistency (files missing their folder's usual tags) | Section 12 |
| Open the inbox (files without tags) | Section 13: the explorer's Inbox tab |

| Setting | Default | Effect |
|---|---|---|
| Store file tags in | File name | Where new tags of non-note files go: the name, or a `.ts` sidecar |
| Note tags in frontmatter | On | New tags of a note go to its `tags` property; the note is not renamed |
| Tag naming rule | On | Section 3 |
| Liaison words | French + English list | Words never used as tags while the rule is on; empty the box to restore the list |
| Lower-case new tags | Off | Only used while the naming rule is off (the rule implies it) |
| Move .ts metadata with renamed files | On | A file renamed or moved in Obsidian takes its sidecar and thumbnail along. Off: they stay under the old name, so the file loses its sidecar tags; the files of a renamed folder keep theirs (the folder's `.ts` moves with it) |
| File extension as a tag | On | Section 1: every file carries its extension as a tag, shown before its name in the explorer; the panel's tag lists show them only with its file type icon on (Section 5, off by default) |
| Colour tags automatically | On | Section 8 |
| Tags panel: *Only tags used a number of times* / *Used at least* / *Used at most* | Off / 10 / 100 | Sections 5 and 10: the panel's All tab and the explorer's root show only the tags used that many times (*at most* 0: no limit); their boxes and *See all* change the same values |
| Show tag badges / Badges for | On / All tags | Explorer badges (Section 8); *Badges for* leaves out of the count and the list the tags already readable in the name |
| Claude Code program | empty | For *Suggest tags with Claude Code* (Section 9). Empty: `claude` on the PATH, then `~/.local/bin`; otherwise the full path of `claude.exe` |
| Model | empty | The model that suggests tags and synonyms (`sonnet`, `haiku`: cheaper for many files). Empty: Claude Code's own default |
| Inbox | | *Open the inbox*; *Days in the inbox* (30); *Inbox folder* (empty: the whole vault); *Tag new files with the rules automatically* (off); *Show dismissed files again* (Section 13) |
| Auto-tag rules | none | Section 13: click to edit, **+** to add, the bin to delete |
| Excluded from the tag engine | none | Section 13: the files and folders excluded by right-click; the bin includes one again |
| Bring in files from outside the vault | none | Section 13: folders of your computer whose new files are moved into a vault folder; click to edit, **+** to add, the bin to stop |
| Exclusion rules | none | Section 13: click to edit, **+** to add, the bin to delete |
| Tag maintenance | | *Tag tools*: opens the panel's Tools tab, where the actions are (Section 5) |

Everything the plugin adds says so: its context-menu items are under one **TagEverything** submenu, its commands
read *TagEverything: …* in the command palette, its notices start with *TagEverything:*, and its panel, explorer
and dialogs are titled *TagEverything*. It lives in four places only: the explorers (Obsidian's, with its badges, and
the TagEverything explorer, with the inbox), the right-click menu (actions on chosen items), the panel (tags, search, tools)
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
