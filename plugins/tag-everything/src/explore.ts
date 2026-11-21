// Pure logic of the TagEverything explorer (src/explorer.ts): the nodes of its tag tree and the order of its rows.
// No `obsidian` import, so `node --test` runs it.

import { type Expr, formulaTags, prune, resolveTags, tryParseFormula } from "./formula.ts";

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

/** What the explorer's formula box filters the tree by. */
export interface TreeSearch {
  /** The formula as written; while the box holds a syntax error, the last valid one, so the tree does not flicker. */
  parsed: Expr | null;
  /** The formula applied: tags spelled as in the vault, those no item carries left out. Null = the whole tree. */
  expr: Expr | null;
  /** Why the box is not applied as typed: a syntax error, or tags no item carries. */
  problem: string | null;
}

/**
 * Reads the explorer's formula box (the panel's group formula syntax): `known` = every tag of the vault, `last` = the
 * previous `parsed`. Unknown tags are left out as in the panel's searches, so a tag still being typed does not empty
 * the tree.
 */
export function treeSearch(text: string, known: readonly string[], last: Expr | null): TreeSearch {
  if (!text.trim()) return { parsed: null, expr: null, problem: null };
  const r = tryParseFormula(text);
  const parsed = "expr" in r ? r.expr : last;
  let problem = "error" in r ? r.error : null;
  if (!parsed) return { parsed, expr: null, problem };
  const has = new Set(known);
  const resolved = resolveTags(parsed, known);
  const unknown = formulaTags(resolved).filter((t) => !has.has(t));
  if (unknown.length && !problem) problem = `No item carries ${unknown.join(", ")} (left out)`;
  return { parsed, expr: prune(resolved, (t) => has.has(t)), problem };
}
