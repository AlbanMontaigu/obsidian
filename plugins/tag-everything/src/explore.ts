// Pure logic of the TagEverything explorer (src/explorer.ts): the nodes of its tag tree and the order of its rows.
// No `obsidian` import, so `node --test` runs it.

/** One node of the tag tree: the path of tags opened to reach it (`trail`), what it holds. */
export interface TagNode {
  /** Paths carrying every tag of the trail: what the node's branches are computed from. */
  paths: string[];
  /** The other tags of those items, with how many of them carry each, in name order: the node's branches. */
  tags: [string, number][];
  /**
   * The items carrying the trail's tags and no other: the files of the node. An item with more tags sits deeper, at
   * the end of each path made of its tags (so in several places). Empty at the root (an item with no tag is not in
   * the tree).
   */
  items: string[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Name order as in a file explorer: case and accents ignored, numbers by value (`file2` before `file10`). */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** Explorer order: folders first, then by name. */
export function compareItems(a: { name: string; folder: boolean }, b: { name: string; folder: boolean }): number {
  return Number(b.folder) - Number(a.folder) || compareNames(a.name, b.name);
}

/**
 * The tree node reached by opening the tags of `trail` one inside the other. `paths` may be the parent node's
 * `paths` (a subset holding every candidate), so a deep node does not rescan the whole vault.
 */
export function tagNode(paths: Iterable<string>, tagsOf: (path: string) => readonly string[], trail: readonly string[]): TagNode {
  const matched: string[] = [];
  const items: string[] = [];
  const counts = new Map<string, number>();
  for (const path of paths) {
    const tags = tagsOf(path);
    if (!trail.every((t) => tags.includes(t))) continue;
    matched.push(path);
    let other = false;
    for (const t of tags) {
      if (trail.includes(t)) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
      other = true;
    }
    if (!other && trail.length) items.push(path);
  }
  return { paths: matched, tags: [...counts].sort((a, b) => compareNames(a[0], b[0])), items };
}

/** Lower case without accents, so a search for `ete` finds `Été`. */
const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * The explorer's filter box: the tags whose name contains `query` (case and accents ignored), in the order given.
 * An empty query keeps them all.
 */
export function filterTags<T extends readonly [string, ...unknown[]]>(tags: readonly T[], query: string): T[] {
  const q = fold(query.trim());
  return q ? tags.filter(([t]) => fold(t).includes(q)) : [...tags];
}
