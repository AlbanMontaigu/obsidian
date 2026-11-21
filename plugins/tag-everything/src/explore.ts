// Pure logic of the TagEverything explorer (src/explorer.ts): the nodes of its tag tree and the order of its rows.
// No `obsidian` import, so `node --test` runs it.

import { type Expr, formatFormula, formulaTags, prune, resolveTags, tryParseFormula } from "./formula.ts";

/** One node of the tag tree: the path of tags opened to reach it (`trail`), what it holds. */
export interface TagNode {
  /** Paths carrying every tag of the trail: what the node's branches are computed from. */
  paths: string[];
  /**
   * The node's branches: the other tags of those items, with how many of them carry each, in name order. At the root,
   * every tag. Inside a tag, only the tags that tell its items apart: not one every item carries (it would hold the
   * same items) nor one on a single item (that item shows directly instead).
   */
  tags: [string, number][];
  /**
   * The files of the node: the items that no branch leads to (their other tags are on every item of the node) and the
   * items alone under one of their tags. An item can so show in several places. Empty at the root (an item with no
   * tag is not in the tree).
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
  const matched: [string, string[]][] = [];
  const counts = new Map<string, number>();
  for (const path of paths) {
    const tags = tagsOf(path);
    if (!trail.every((t) => tags.includes(t))) continue;
    const other = tags.filter((t) => !trail.includes(t));
    matched.push([path, other]);
    for (const t of other) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const all = [...counts].sort((a, b) => compareNames(a[0], b[0]));
  const node = { paths: matched.map(([p]) => p), tags: all, items: [] as string[] };
  if (!trail.length) return node; // the root is the index of every tag, whatever it holds
  node.tags = all.filter(([, c]) => c > 1 && c < matched.length);
  const branch = new Set(node.tags.map(([t]) => t));
  const alone = (t: string): boolean => counts.get(t) === 1;
  node.items = matched.filter(([, other]) => other.some(alone) || !other.some((t) => branch.has(t))).map(([p]) => p);
  return node;
}

/**
 * The explorer box's whole formula: its chips (in parentheses, so `a OR b` then `c` = `(a OR b) AND c`), then the
 * text being typed, which may start with an operator (`OR c`).
 */
export function joinFormula(chips: Expr | null, typed: string): string {
  return [chips && `(${formatFormula(chips)})`, typed.trim()].filter(Boolean).join(" ");
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
