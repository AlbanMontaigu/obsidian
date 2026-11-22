// Put away: the folder a tagged file belongs in, learned from where the files with the same tags already are. Pure,
// no `obsidian` import (unit-tested); the dialog is putaway-modal.ts, the move `main.ts` `moveFiles`.
//
// A folder's habits are the tags most of its own files carry (not those of its subfolders). A folder is a destination
// for a file when the file carries every habit of the folder: `Bills/Power` (bill, power) for a file tagged
// `bill power 2026`. The more habits matched, the more specific the folder, the better; then the bigger folder.

import { parentOf } from "./format.ts";
import { cleanFolder, inFolder } from "./inbox.ts";
import { HABIT_SHARE } from "./consistency.ts";
import type { FileTags } from "./consistency.ts";

/** Files carrying a tag, at least, for it to be a folder's habit: one file says nothing about a folder. */
export const MIN_HABIT_FILES = 2;
/** Destinations offered per file. */
export const MAX_DESTINATIONS = 3;

/** A folder and the tags its files usually carry. */
export interface FolderHabit {
  folder: string;
  /** Lower case, sorted. */
  tags: string[];
  /** Files directly in the folder. */
  size: number;
}

/** The habits of every folder of `files` that has some; the vault root has none (files there are not filed yet). */
export function folderHabits(files: readonly FileTags[]): FolderHabit[] {
  const folders = new Map<string, FileTags[]>();
  for (const f of files) {
    const folder = parentOf(f.path);
    if (!folder) continue;
    const list = folders.get(folder);
    if (list) list.push(f);
    else folders.set(folder, [f]);
  }
  const out: FolderHabit[] = [];
  for (const [folder, members] of folders) {
    const counts = new Map<string, number>();
    for (const f of members) for (const t of new Set(f.tags.map((x) => x.toLowerCase()))) counts.set(t, (counts.get(t) ?? 0) + 1);
    const need = Math.max(MIN_HABIT_FILES, HABIT_SHARE * members.length);
    const tags = [...counts].filter(([, n]) => n >= need).map(([t]) => t).sort();
    if (tags.length) out.push({ folder, tags, size: members.length });
  }
  return out;
}

/** Habits by each of their tags: a file is only compared with the folders sharing one of its tags. */
export type HabitIndex = ReadonlyMap<string, readonly FolderHabit[]>;

/**
 * Is the file at `path` in one of the `transit` folders (inbox, landing folders of brought-in files), at any depth?
 * Case and accents ignored, as for the inbox folder. Files there are waiting to be put away.
 */
export function inTransit(path: string, transit: readonly string[]): boolean {
  // an empty folder means "anywhere" to inFolder: here it means no transit folder
  return transit.some((f) => cleanFolder(f) && inFolder(path, f));
}

/** Indexes `habits`, leaving out the `transit` folders and their subfolders: never a home. */
export function habitIndex(habits: readonly FolderHabit[], transit: readonly string[] = []): HabitIndex {
  const out = new Map<string, FolderHabit[]>();
  for (const h of habits) {
    if (inTransit(`${h.folder}/`, transit)) continue;
    for (const t of h.tags) {
      const list = out.get(t);
      if (list) list.push(h);
      else out.set(t, [h]);
    }
  }
  return out;
}

/** The folders whose habits all are among `tags`, best first. */
function matching(tags: readonly string[], index: HabitIndex): FolderHabit[] {
  const own = new Set(tags.map((t) => t.toLowerCase()));
  const seen = new Set<FolderHabit>();
  for (const t of own) for (const h of index.get(t) ?? []) if (h.tags.every((x) => own.has(x))) seen.add(h);
  return [...seen].sort((a, b) => b.tags.length - a.tags.length || b.size - a.size || a.folder.localeCompare(b.folder));
}

/**
 * Where the file at `path` with these stored `tags` could go, best first, at most MAX_DESTINATIONS. Only the folders
 * better than the one it is in: a file whose folder already fits its tags as well as any other stays where it is.
 */
export function destinationsFor(path: string, tags: readonly string[], index: HabitIndex): FolderHabit[] {
  if (!tags.length) return [];
  const here = parentOf(path).toLowerCase();
  const all = matching(tags, index);
  const i = all.findIndex((h) => h.folder.toLowerCase() === here);
  return (i < 0 ? all : all.slice(0, i)).slice(0, MAX_DESTINATIONS);
}
