# TagEverything: known limits and ideas not done

For developers and Claude: what the plugin does not do (yet), what it relies on, what was not measured. Read the
entry of the area you change; add one when you leave a limit behind (users' side: `user-guide.md`).

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
  A file can show in several places (directly where it is alone under a tag, and down each branch it is in; only
  what is opened is drawn). Untagged files are not
  in the tree. Showing a file the core explorer hides in the file explorer only opens its folder.
- Explorer ideas: reveal the active file in the tree, keyboard arrows between rows,
  extension tags as branches (an option).
- Inline `#tags` in a note's body are not read (only frontmatter): they can't be removed through a property edit.
- Tag groups don't follow a tag renamed outside the plugin (they keep the old name, shown faded); they do follow a
  *Check tag names* fix, a rename / merge and a review (all through `replaceTags`).
- Naming rule: inline `#tags` in a note body are neither read nor fixed. `/` splits like `-`, so the rule allows no
  nested tag (turn it off to use them in notes). A tag fixed in a file name on a case-sensitive disk relies on Obsidian's rename (tested on
  Windows only). The liaison word list is a guess: the owner can edit it in the settings.
- Deleting a file in Obsidian leaves its `.ts` sidecar (orphan, ignored by the scan); a file created later with the
  same name would pick its tags up at the next rebuild. Not deleted on purpose (never delete metadata unasked).
- The panel re-renders on every index change even when hidden (cheap: counts are cached and the search runs once per render),
  and on vault create / delete / rename (debounced 300 ms); the Tools tab runs the rules over every file when shown. The
  explorer redraws on the same events for the inbox count on its tab, which scans every vault file (`inboxFiles`). Not measured on the owner's 9 500-file vault.
- The AI assistant guide is a snapshot (tag lists, settings) and is never overwritten, so it goes stale: the owner
  deletes and rewrites it. A refresh that rewrites only a marked section of an existing `CLAUDE.md` would fix it, but
  touches a file the owner may have edited (not done: never overwrite).
- Claude Code suggestions: the smoke test fakes Claude Code (cost, login, non-deterministic): after changing the
  prompt or the flags, run it once for real on a small folder. An npm `claude.cmd` can't be spawned without a shell:
  the setting must point to the `.exe`. At most 50 items per run; the prompt lists at most 300 vault tags. Folder
  tags are suggested from what the folder holds. Claude Code's `--safe-mode` / `--tools` flags are from 2.1.x: an
  older CLI refuses them (the dialog shows its error).
- Query blocks: only indexed items are found (every file with extension tags on, tagged items only with them off).
  A block doesn't follow a renamed tag (it names the tag no item carries). Date terms (`modified:7d`) filter, `sort:
  modified` orders.
- Review: look-alikes are a heuristic (stem = folded, final s / x dropped; one typo between 5+ letter words without
  digits): `livre` / `libre` are offered unticked. Synonyms send at most 1 000 tags (most used first). The synonym
  prompt was checked for real on 2026-11-21 (haiku: 3 s, $0.001 for 8 tags, translations and synonyms grouped,
  related-only tags kept apart); after changing it or `SYNONYM_TASK`, run it again by hand.
- Inbox: "arrived" = `stat.ctime` (created in the vault: a download, a sync, a copy; a move inside the vault is not
  new). Dismissed paths are kept in `data.json` and don't follow a rename. The inbox lists notes too (any untagged
  file). At most 200 rows drawn. Auto-tag on arrival waits 2 s after the last create of a burst; a file still being
  written by another app may refuse the rename (the failure notice says so; the file stays in the inbox).
- `main.ts` is ~650 lines (over the ~500 guideline) even with the Claude Code runner (0.26.0) and the menus (0.28.0)
  moved out; `view.ts` ~790 (0.34.0, date criteria) after the Groups section moved to `panel-groups.ts` (0.30.0): the bookmark tabs (`renderTabs`, tab menu, bookmark items) are the next to move out. The next feature in `main.ts` should first move the write path (`enqueue`, `applyNow`, `applyOne`, `readFrontTags`) to its own module.
- Exclusions: any change rebuilds the index (an item included again has its sidecar to read). The badges check every
  row of the file explorer while there are exclusions (cached per path). An item can't be included alone inside an
  excluded folder (no allow-list): include the folder, exclude the others. Like any tag no item carries any more, a
  tag carried only by excluded items leaves the panel's search (it is not put back on inclusion).
- Date criteria (src/dates.ts; date terms of src/formula.ts): the menus offer presets only (1, 7, 30, 90, 365 days;
  older than 30, 90, 365 days); any number can be typed in a formula (`created:45d`). "Created" is `stat.ctime`: a
  copy or a sync can make an old document new. A folder has no date, so a date term never matches one (`NOT
  created:30d` does). Relative to now: a group's or a block's results change with time, and a query block only
  redraws on a vault or tag change, not when a day passes. The explorer's calendar edits only the dates ANDed at the
  top of its box (others are typed). The inbox's criteria are not remembered across restarts (the panel's are, with
  its search).
- Ideas: colours editable in settings; tag search in the quick switcher; a command to move a note's name tags into
  its frontmatter (renames the note, so opt-in); a rename / merge that also rewrites query blocks.
