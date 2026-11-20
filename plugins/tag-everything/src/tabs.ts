// Bookmark tabs of the File tags panel: pure logic, no `obsidian` import (unit-tested under node --test).
// The panel's first tab, "All", shows every group and tag; each bookmark tab, named by the user, shows only the tags
// and groups bookmarked in it. Tabs live in data.json (settings.tabs). Every function returns a new array.

import { cleanGroupName, nextGroupId } from "./groups.ts";

export interface BookmarkTab {
  /** Stable id ("t1", "t2"...). */
  id: string;
  name: string;
  /** Bookmarked tags, in the order they were added. */
  tags: string[];
  /** Ids of the bookmarked tag groups, in the order they were added. */
  groups: string[];
}

export type BookmarkKind = "tags" | "groups";

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim()))] : [];

/** Tabs read from data.json: anything malformed is dropped or repaired; group ids not in `groupIds` are dropped. */
export function normalizeTabs(raw: unknown, groupIds: readonly string[]): BookmarkTab[] {
  if (!Array.isArray(raw)) return [];
  const out: BookmarkTab[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const name = typeof r.name === "string" ? cleanGroupName(r.name) : "";
    if (!name) continue;
    const taken = new Set(out.map((x) => x.id));
    const id = typeof r.id === "string" && /^t\d+$/.test(r.id) && !taken.has(r.id) ? r.id : "";
    out.push({ id, name, tags: strings(r.tags), groups: strings(r.groups).filter((g) => groupIds.includes(g)) });
  }
  // ids given last, so a repaired one never takes the id of a later valid tab
  for (const tab of out) if (!tab.id) tab.id = nextGroupId(out.filter((x) => x.id), "t");
  return out;
}

/** Adds a tab at the end. Throws on an empty name (the caller shows the message). */
export function addTab(tabs: readonly BookmarkTab[], name: string): { tabs: BookmarkTab[]; id: string } {
  const clean = cleanGroupName(name);
  if (!clean) throw new Error("A tab needs a name");
  const id = nextGroupId(tabs, "t");
  return { tabs: [...tabs, { id, name: clean, tags: [], groups: [] }], id };
}

export function renameTab(tabs: readonly BookmarkTab[], id: string, name: string): BookmarkTab[] {
  const clean = cleanGroupName(name);
  if (!clean) throw new Error("A tab needs a name");
  return tabs.map((t) => (t.id === id ? { ...t, name: clean } : t));
}

export function deleteTab(tabs: readonly BookmarkTab[], id: string): BookmarkTab[] {
  return tabs.filter((t) => t.id !== id);
}

/** Bookmarks (`on`) or un-bookmarks a tag or a group id in tab `id`. Adding twice keeps one. */
export function setBookmark(tabs: readonly BookmarkTab[], id: string, kind: BookmarkKind, value: string, on: boolean): BookmarkTab[] {
  return tabs.map((t) => {
    if (t.id !== id || t[kind].includes(value) === on) return t;
    return { ...t, [kind]: on ? [...t[kind], value] : t[kind].filter((v) => v !== value) };
  });
}

/** A deleted group leaves every tab. */
export function forgetGroup(tabs: readonly BookmarkTab[], groupId: string): BookmarkTab[] {
  return tabs.map((t) => (t.groups.includes(groupId) ? { ...t, groups: t.groups.filter((g) => g !== groupId) } : t));
}
