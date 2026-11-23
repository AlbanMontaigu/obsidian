// Inherited tags: what an item carries because of the folders it is in (settings `inheritFolderTags`,
// `folderNameTags`). Computed from the folder tree, never written. Pure, no `obsidian` import (unit-tested under node --test).
//
// - `inheritFolderTags`: a folder's stored tags (`tsm.json`) pass to every file and folder below it.
// - `folderNameTags`: a folder's name, split like a tag (naming rule words), is a tag of the folder and of everything
//   below it, unless the folder keeps its name to itself (setting `keptFolderNames`, set by right-click): then the
//   folder still carries it, what is inside doesn't. Its stored tags still pass down.

import { baseOf, parentOf } from "./format.ts";
import { type NamingRule, suggestFix } from "./naming.ts";

export interface InheritOptions {
  /** A folder's stored tags pass to everything below it. */
  inherit: boolean;
  /** A folder's name gives tags to the folder and to everything below it. */
  folderNames: boolean;
}

/** Is any inheritance on? Off: no item has inherited tags, nothing is computed. */
export function inheriting(opts: InheritOptions): boolean {
  return opts.inherit || opts.folderNames;
}

/** An ordering prefix in front of a folder name: `1. `, `02 - `, `3_`, `10) `. A year alone (`2025`) is kept. */
const ORDER_PREFIX = /^\d+\s*[.)_-]\s*(?=\S)/u;

/**
 * The tags a folder name gives: its plain words, lower-cased, liaison words left out, after an ordering prefix.
 * `1. Projects` → `projects`; `B27 Board` → `b27 board`; `Plan de charge` → `plan charge`; `2025` → `2025`.
 */
export function folderNameTags(name: string, rule: NamingRule): string[] {
  return suggestFix(name.replace(ORDER_PREFIX, "").trim(), rule);
}

/** What the computation reads about the vault (the index gives it). */
export interface InheritSource {
  /** The folder's stored tags (`tsm.json`); [] for an excluded folder. */
  ownOf(folderPath: string): readonly string[];
  /** The tags its name gives (`folderNameTags`), cached by the caller if it wants. */
  nameTagsOf(folderName: string): readonly string[];
  /** Excluded from the tag engine: passes nothing, gets nothing. */
  excluded(path: string, isFolder: boolean): boolean;
  /** The folder keeps its name's tags to itself (`keptFolderNames`): they don't pass to what is inside it. */
  keepsName?(folderPath: string): boolean;
}

/** Keeps (`on`) a folder's name to itself, or passes it down again: the new `keptFolderNames`, each path once. */
export function setKeptName(paths: readonly string[], folder: string, on: boolean): string[] {
  const others = paths.filter((p) => p !== folder);
  return on ? [...others, folder] : others;
}

/** One folder's contribution, with the folder it comes from (for "inherited from …"). */
interface Given {
  tag: string;
  from: string;
}

/**
 * Computes inherited tags for a whole tree. `tagsOf(path, isFolder)` = the tags the item inherits (its own name's tags
 * for a folder with `folderNames`, then what its folders pass down, nearest first), not counting the ones it stores:
 * the caller removes those. Folder results are memoised: build one per index change.
 */
export class Inheritance {
  /** Folder path → what it passes to what is inside it, nearest folder first. */
  private passed = new Map<string, readonly Given[]>();
  private opts: InheritOptions;
  private src: InheritSource;

  constructor(opts: InheritOptions, src: InheritSource) {
    this.opts = opts;
    this.src = src;
  }

  /** What the folder gives to what is inside it (its stored tags with `inherit`, its name's with `folderNames` unless it keeps them). */
  private gives(folder: string): Given[] {
    if (!folder || this.src.excluded(folder, true)) return [];
    const names = this.opts.folderNames && !this.src.keepsName?.(folder);
    const tags = [...(names ? this.src.nameTagsOf(baseOf(folder)) : []), ...(this.opts.inherit ? this.src.ownOf(folder) : [])];
    return tags.map((tag) => ({ tag, from: folder }));
  }

  /** What `folder` passes down: its own gifts, then its parent's, each tag once (the nearest folder wins). */
  private passedBy(folder: string): readonly Given[] {
    if (!folder) return [];
    let out = this.passed.get(folder);
    if (!out) {
      out = firstOfEach([...this.gives(folder), ...this.passedBy(parentOf(folder))]);
      this.passed.set(folder, out);
    }
    return out;
  }

  /** Every tag the item inherits, with where it comes from, nearest first. A folder's name tags come from itself. */
  given(path: string, isFolder: boolean): readonly Given[] {
    if (!path || this.src.excluded(path, isFolder)) return [];
    const above = this.passedBy(parentOf(path));
    if (!isFolder || !this.opts.folderNames) return above;
    return firstOfEach([...this.src.nameTagsOf(baseOf(path)).map((tag) => ({ tag, from: path })), ...above]);
  }

  /** The tags the item inherits, minus `stored` (the tags it already carries). */
  tagsOf(path: string, isFolder: boolean, stored: ReadonlySet<string> = new Set()): string[] {
    return this.given(path, isFolder).map((g) => g.tag).filter((t) => !stored.has(t));
  }

  /** The folder the item inherits `tag` from (the nearest), or null. */
  sourceOf(path: string, isFolder: boolean, tag: string): string | null {
    return this.given(path, isFolder).find((g) => g.tag === tag)?.from ?? null;
  }
}

/** Each tag once, its first (nearest) source kept. */
function firstOfEach(gifts: readonly Given[]): Given[] {
  const seen = new Set<string>();
  return gifts.filter((g) => !seen.has(g.tag) && (seen.add(g.tag), true));
}
