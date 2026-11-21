// Tag groups of the File tags panel: pure logic, no `obsidian` import (unit-tested under node --test).
// Groups live in the plugin's data.json (settings.groups). Every function returns a new array and never mutates.
// A group without a formula searches for all its tags (AND); with one, its tags are exactly the formula's tags.

import { type Expr, andOf, formatFormula, formulaTags, prune, replaceTagsInExpr, tagExpr, toggleNot, tryParseFormula } from "./formula.ts";

export interface TagGroup {
  /** Stable id ("g1", "g2"...), never reused while the group exists. */
  id: string;
  name: string;
  /** Tags of the group, in the order they were added. A tag may belong to several groups. */
  tags: string[];
  /** Folded in the panel. */
  collapsed: boolean;
  /** Search formula over the tags (src/formula.ts, canonical text); absent = every tag, AND. */
  formula?: string;
}

export const MAX_GROUP_NAME = 80;

/** Trimmed, inner whitespace collapsed, capped. Empty string = no valid name. */
export function cleanGroupName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_GROUP_NAME);
}

/** Groups read from data.json: anything malformed is dropped or repaired, never thrown on. */
export function normalizeGroups(raw: unknown): TagGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: TagGroup[] = [];
  const ids = new Set<string>();
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const r = g as Record<string, unknown>;
    const name = typeof r.name === "string" ? cleanGroupName(r.name) : "";
    if (!name) continue;
    let id = typeof r.id === "string" && r.id && !ids.has(r.id) ? r.id : "";
    if (!id) id = nextGroupId([...out, ...raw.filter(isIdHolder)]);
    ids.add(id);
    const tags = Array.isArray(r.tags) ? [...new Set(r.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim()))] : [];
    const group: TagGroup = { id, name, tags, collapsed: r.collapsed === true };
    // Kept even if it doesn't parse (written by hand?): the panel shows the error instead of losing it.
    if (typeof r.formula === "string" && r.formula.trim()) group.formula = r.formula.trim();
    out.push(group);
  }
  return out;
}

function isIdHolder(g: unknown): g is { id: string } {
  return !!g && typeof g === "object" && typeof (g as { id?: unknown }).id === "string";
}

/** "<prefix><n>" ("g1"...) with n above every numeric id in use. Bookmark tabs use the prefix "t". */
export function nextGroupId(groups: readonly { id: string }[], prefix = "g"): string {
  let max = 0;
  for (const g of groups) {
    if (!g.id.startsWith(prefix)) continue;
    const n = g.id.slice(prefix.length);
    if (/^\d+$/.test(n)) max = Math.max(max, Number(n));
  }
  return `${prefix}${max + 1}`;
}

/** Adds a group at the end. Throws on an empty name (the caller shows the message). */
export function addGroup(groups: readonly TagGroup[], name: string, tags: readonly string[] = []): { groups: TagGroup[]; id: string } {
  const clean = cleanGroupName(name);
  if (!clean) throw new Error("A group needs a name");
  const id = nextGroupId(groups);
  return { groups: [...groups, { id, name: clean, tags: [...new Set(tags)], collapsed: false }], id };
}

function update(groups: readonly TagGroup[], id: string, fn: (g: TagGroup) => TagGroup): TagGroup[] {
  return groups.map((g) => (g.id === id ? fn(g) : g));
}

export function renameGroup(groups: readonly TagGroup[], id: string, name: string): TagGroup[] {
  const clean = cleanGroupName(name);
  if (!clean) throw new Error("A group needs a name");
  return update(groups, id, (g) => ({ ...g, name: clean }));
}

export function deleteGroup(groups: readonly TagGroup[], id: string): TagGroup[] {
  return groups.filter((g) => g.id !== id);
}

function parsedFormula(g: TagGroup): Expr | null {
  if (!g.formula) return null;
  const r = tryParseFormula(g.formula);
  return "expr" in r ? r.expr : null;
}

/** What the group searches for: its formula, else all its tags (AND). Null for an empty group. */
export function groupExpr(g: TagGroup): Expr | null {
  return parsedFormula(g) ?? andOf(g.tags.map(tagExpr));
}

/** The formula's syntax error, if it has a formula that doesn't parse. */
export function formulaError(g: TagGroup): string | null {
  if (!g.formula) return null;
  const r = tryParseFormula(g.formula);
  return "error" in r ? r.error : null;
}

function withFormula(g: TagGroup, expr: Expr | null): TagGroup {
  const { formula: _old, ...rest } = g;
  return expr ? { ...rest, formula: formatFormula(expr), tags: formulaTags(expr) } : { ...rest, tags: [] };
}

/** Sets the group's formula (its tags become the formula's), or removes it with null (the tags stay, AND). */
export function setFormula(groups: readonly TagGroup[], id: string, expr: Expr | null): TagGroup[] {
  return update(groups, id, (g) => {
    if (expr) return withFormula(g, expr);
    const { formula: _old, ...rest } = g;
    return rest;
  });
}

/** Adds tags not already in the group, at the end; with a formula, as `formula AND tag`. */
export function addTagsToGroup(groups: readonly TagGroup[], id: string, tags: readonly string[]): TagGroup[] {
  return update(groups, id, (g) => {
    const fresh = tags.filter((t) => !g.tags.includes(t));
    const expr = parsedFormula(g);
    if (expr && fresh.length) return withFormula(g, andOf([expr, ...fresh.map(tagExpr)]));
    return { ...g, tags: [...new Set([...g.tags, ...tags])] };
  });
}

/** Removes the tag from the group and from its formula (as if never written there). */
export function removeTagFromGroup(groups: readonly TagGroup[], id: string, tag: string): TagGroup[] {
  return update(groups, id, (g) => {
    const expr = parsedFormula(g);
    if (expr) return withFormula(g, prune(expr, (t) => t !== tag));
    return { ...g, tags: g.tags.filter((t) => t !== tag) };
  });
}

/**
 * Excludes the tag from the group's search (`NOT tag`), or includes it again. A group without a formula gets one:
 * all its tags (AND), that one negated. An unparsable formula is left alone.
 */
export function toggleTagNot(groups: readonly TagGroup[], id: string, tag: string): TagGroup[] {
  return update(groups, id, (g) => {
    if (!g.tags.includes(tag) || formulaError(g)) return g;
    const expr = groupExpr(g);
    return expr ? withFormula(g, toggleNot(expr, tag)) : g;
  });
}

export function setCollapsed(groups: readonly TagGroup[], id: string, collapsed: boolean): TagGroup[] {
  return update(groups, id, (g) => ({ ...g, collapsed }));
}

/** Moves group `id` before group `beforeId` (or to the end when `beforeId` is null). */
export function moveGroup(groups: readonly TagGroup[], id: string, beforeId: string | null): TagGroup[] {
  const moving = groups.find((g) => g.id === id);
  if (!moving || id === beforeId) return [...groups];
  const rest = groups.filter((g) => g.id !== id);
  const at = beforeId === null ? rest.length : rest.findIndex((g) => g.id === beforeId);
  rest.splice(at < 0 ? rest.length : at, 0, moving);
  return rest;
}

/**
 * Follows a vault-wide tag fix (src/naming.ts): each mapped tag is replaced by its replacements, in the tag list and
 * in the formula (as `a AND b`; a tag mapped to nothing is pruned). An unparsable formula is left alone. Groups not
 * naming a mapped tag are returned as they are.
 */
export function replaceTagsInGroups(groups: readonly TagGroup[], mapping: ReadonlyMap<string, readonly string[]>): TagGroup[] {
  return groups.map((g) => {
    if (!g.tags.some((t) => mapping.has(t))) return g;
    if (formulaError(g)) return g;
    const expr = parsedFormula(g);
    if (expr) return withFormula(g, replaceTagsInExpr(expr, mapping));
    return { ...g, tags: [...new Set(g.tags.flatMap((t) => mapping.get(t) ?? [t]))] };
  });
}
