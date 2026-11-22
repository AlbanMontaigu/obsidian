// Tag groups of the TagEverything panel: pure logic, no `obsidian` import (unit-tested under node --test).
// Groups live in the plugin's data.json (settings.groups). Every function returns a new array and never mutates.
// A group without a formula searches for all its tags (AND); with one, its tags are exactly the formula's tags.

import { type TagMapping, mapTagList } from "./format.ts";
import { type DateExpr, type Expr, andOf, formatFormula, formulaTags, prune, replaceTagsInExpr, tagExpr, toggleNot, tryParseFormula } from "./formula.ts";
import { sameRange } from "./dates.ts";

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

export const MAX_NAME = 80;

/** A group or tab name: trimmed, inner whitespace collapsed, capped. Empty string = no valid name. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

/** A tag list read from data.json: non-empty strings only, trimmed, once each. Anything else -> []. */
export function cleanTagList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim()))];
}

/** Groups read from data.json: anything malformed is dropped or repaired, never thrown on. */
export function normalizeGroups(raw: unknown): TagGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: TagGroup[] = [];
  const ids = new Set<string>();
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const r = g as Record<string, unknown>;
    const name = typeof r.name === "string" ? cleanName(r.name) : "";
    if (!name) continue;
    let id = typeof r.id === "string" && r.id && !ids.has(r.id) ? r.id : "";
    if (!id) id = nextId([...out, ...raw.filter(isIdHolder)]);
    ids.add(id);
    const group: TagGroup = { id, name, tags: cleanTagList(r.tags), collapsed: r.collapsed === true };
    // Kept even if it doesn't parse (written by hand?): the panel shows the error instead of losing it.
    if (typeof r.formula === "string" && r.formula.trim()) group.formula = r.formula.trim();
    out.push(group);
  }
  return out;
}

function isIdHolder(g: unknown): g is { id: string } {
  return !!g && typeof g === "object" && typeof (g as { id?: unknown }).id === "string";
}

/** "<prefix><n>" with n above every numeric id in use: groups "g1", "g2"..., bookmark tabs "t1"... */
export function nextId(items: readonly { id: string }[], prefix = "g"): string {
  let max = 0;
  for (const { id } of items) {
    if (!id.startsWith(prefix)) continue;
    const n = id.slice(prefix.length);
    if (/^\d+$/.test(n)) max = Math.max(max, Number(n));
  }
  return `${prefix}${max + 1}`;
}

/** Adds a group at the end. Throws on an empty name (the caller shows the message). */
export function addGroup(groups: readonly TagGroup[], name: string, tags: readonly string[] = []): { groups: TagGroup[]; id: string } {
  const clean = cleanName(name);
  if (!clean) throw new Error("A group needs a name");
  const id = nextId(groups);
  return { groups: [...groups, { id, name: clean, tags: [...new Set(tags)], collapsed: false }], id };
}

function update(groups: readonly TagGroup[], id: string, fn: (g: TagGroup) => TagGroup): TagGroup[] {
  return groups.map((g) => (g.id === id ? fn(g) : g));
}

export function renameGroup(groups: readonly TagGroup[], id: string, name: string): TagGroup[] {
  const clean = cleanName(name);
  if (!clean) throw new Error("A group needs a name");
  return update(groups, id, (g) => ({ ...g, name: clean }));
}

export function deleteGroup(groups: readonly TagGroup[], id: string): TagGroup[] {
  return groups.filter((g) => g.id !== id);
}

/** The group's formula, parsed; null without one or when it does not parse. */
export function groupFormula(g: TagGroup): Expr | null {
  if (!g.formula) return null;
  const r = tryParseFormula(g.formula);
  return "expr" in r ? r.expr : null;
}

/** What the group searches for: its formula, else all its tags (AND). Null for an empty group. */
export function groupExpr(g: TagGroup): Expr | null {
  return groupFormula(g) ?? andOf(g.tags.map(tagExpr));
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

/** The tags of a plain AND of distinct tags (or a single tag), which needs no formula; null otherwise. */
function plainTags(expr: Expr): string[] | null {
  const items = expr.k === "and" ? expr.items : [expr];
  const tags = items.map((e) => (e.k === "tag" ? e.tag : null));
  return tags.every((t): t is string => t !== null) && new Set(tags).size === tags.length ? tags : null;
}

/**
 * Sets what the group searches for, as written in the group dialog: a formula (its tags become the formula's); a
 * plain `a AND b` is kept as the tags `a`, `b` without formula; null empties the group.
 */
export function setFormula(groups: readonly TagGroup[], id: string, expr: Expr | null): TagGroup[] {
  return update(groups, id, (g) => {
    const plain = expr && plainTags(expr);
    if (expr && !plain) return withFormula(g, expr);
    const { formula: _old, ...rest } = g;
    return { ...rest, tags: plain ?? [] };
  });
}

/** Adds tags not already in the group, at the end; with a formula, as `formula AND tag`. */
export function addTagsToGroup(groups: readonly TagGroup[], id: string, tags: readonly string[]): TagGroup[] {
  return update(groups, id, (g) => {
    const fresh = tags.filter((t) => !g.tags.includes(t));
    const expr = groupFormula(g);
    if (expr && fresh.length) return withFormula(g, andOf([expr, ...fresh.map(tagExpr)]));
    return { ...g, tags: [...new Set([...g.tags, ...tags])] };
  });
}

/** Removes the tag from the group and from its formula (as if never written there). */
export function removeTagFromGroup(groups: readonly TagGroup[], id: string, tag: string): TagGroup[] {
  return update(groups, id, (g) => {
    const expr = groupFormula(g);
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

/** Takes a date term (same field and range) out of the group's formula; the rest is unchanged. */
export function removeDateFromGroup(groups: readonly TagGroup[], id: string, term: DateExpr): TagGroup[] {
  return groups.map((g) => {
    if (g.id !== id) return g;
    const expr = groupFormula(g);
    return expr ? withFormula(g, prune(expr, () => true, (d) => !(d.field === term.field && sameRange(d.range, term.range)))) : g;
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
export function replaceTagsInGroups(groups: readonly TagGroup[], mapping: TagMapping): TagGroup[] {
  return groups.map((g) => {
    if (!g.tags.some((t) => mapping.has(t))) return g;
    if (formulaError(g)) return g;
    const expr = groupFormula(g);
    if (expr) return withFormula(g, replaceTagsInExpr(expr, mapping));
    return { ...g, tags: mapTagList(g.tags, mapping) };
  });
}
