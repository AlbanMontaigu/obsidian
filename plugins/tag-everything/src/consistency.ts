// Tag consistency: the files of one folder that nearly all carry the same tag show a habit; the few that don't are
// the exceptions worth a look (forgotten, or misspelled). Pure, no `obsidian` import (unit-tested); the dialog is
// consistency-modal.ts.
//
// A group is the files directly in one folder, and within it the files of one extension (the PDFs of a folder can
// share a tag its notes don't). A tag is a habit of the group when at least MIN_CARRIERS files and HABIT_SHARE of the
// group carry it. A file of the group without it is a finding, except when it belongs to a consistent variant: it
// carries another tag that two or more files of the group share, none of them with the habit (`2025` files in a
// folder of `2024` ones). A file carrying a look-alike of the habit (`factures` for `facture`) is offered the swap.

import { extensionTag, parentOf } from "./format.ts";
import { lookAlike } from "./taxonomy.ts";

/** Files carrying a tag, at least, for it to be a habit. */
export const MIN_CARRIERS = 3;
/** Share of the group carrying a tag, at least, for it to be a habit. */
export const HABIT_SHARE = 0.75;

/** One file of the vault and its stored tags (no extension tag). */
export interface FileTags {
  path: string;
  tags: readonly string[];
}

/** A file missing a tag its group usually carries. */
export interface Finding {
  path: string;
  /** The file's folder ("" = vault root). */
  folder: string;
  /** The habit the file lacks. */
  tag: string;
  /** How many files of the group carry it, of how many. */
  carriers: number;
  size: number;
  /** The group is the folder's files of this extension; null: all the folder's files. */
  ext: string | null;
  /** The file's tags that look like `tag` (plural, accents, typo): probably the same tag misspelled, to replace. */
  replaces: string[];
}

/** The findings of `files`, by folder, then file, then tag. */
export function findInconsistencies(files: readonly FileTags[]): Finding[] {
  const folders = new Map<string, FileTags[]>();
  for (const f of files) {
    const folder = parentOf(f.path);
    folders.set(folder, [...(folders.get(folder) ?? []), f]);
  }
  const out: Finding[] = [];
  for (const [folder, group] of folders) {
    const found = new Set<string>(); // path + tag: the folder-wide finding wins over its extension group's
    const add = (members: readonly FileTags[], ext: string | null): void => {
      for (const f of groupFindings(members, folder, ext)) {
        const key = `${f.path}\u001f${f.tag}`;
        if (found.has(key)) continue;
        found.add(key);
        out.push(f);
      }
    };
    add(group, null);
    const byExt = new Map<string, FileTags[]>();
    for (const f of group) {
      const ext = extensionTag(f.path.slice(f.path.lastIndexOf("/") + 1));
      if (ext) byExt.set(ext, [...(byExt.get(ext) ?? []), f]);
    }
    for (const [ext, members] of byExt) if (members.length < group.length) add(members, ext);
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder) || a.path.localeCompare(b.path) || a.tag.localeCompare(b.tag));
}

/** The findings of one group: its habits, and the files without one (unless in a consistent variant). */
function groupFindings(members: readonly FileTags[], folder: string, ext: string | null): Finding[] {
  const size = members.length;
  if (size < MIN_CARRIERS + 1) return []; // every file would need the tag: nothing to tell apart
  const carriers = new Map<string, FileTags[]>();
  for (const f of members) for (const t of f.tags) carriers.set(t, [...(carriers.get(t) ?? []), f]);
  const habits = [...carriers].filter(([, on]) => on.length >= MIN_CARRIERS && on.length >= HABIT_SHARE * size && on.length < size);
  const out: Finding[] = [];
  for (const [tag, on] of habits) {
    for (const f of members) {
      if (f.tags.includes(tag)) continue;
      const replaces = f.tags.filter((t) => lookAlike(t, tag) && !habits.some(([h]) => h === t));
      const variant = !replaces.length && f.tags.some((t) => {
        const others = carriers.get(t) ?? [];
        return others.length >= 2 && !lookAlike(t, tag) && others.every((o) => !o.tags.includes(tag));
      });
      if (!variant) out.push({ path: f.path, folder, tag, carriers: on.length, size, ext, replaces });
    }
  }
  return out;
}
