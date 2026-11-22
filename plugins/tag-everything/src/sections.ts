// Sections of the TagEverything panel's All tab: pure logic, no `obsidian` import (unit-tested under node --test).
// A section is a named, foldable heading under the groups that holds groups and tags; a group or tag is in one
// section at most, and the groups in none are listed at the top. A tag in a section is still in the Tags list too.
// Sections live in data.json under `tabs` (they were bookmark tabs before 0.37, same shape: an older version still
// reads them). Every function returns a new array.

import { type TagMapping, mapTagList } from "./format.ts";
import { cleanName, cleanTagList, nextId } from "./groups.ts";

export interface Section {
  /** Stable id ("t1", "t2"...: the ids of the bookmark tabs they were). */
  id: string;
  name: string;
  /** Its tags, in the order they were moved in. */
  tags: string[];
  /** Ids of its tag groups, in the order they were moved in. */
  groups: string[];
  /** Folded: only its heading shows. */
  collapsed?: boolean;
}

export type SectionKind = "tags" | "groups";

/**
 * Sections read from data.json: anything malformed is dropped or repaired; group ids not in `groupIds` are dropped.
 * A group or tag in several (bookmark tabs allowed it) stays in the first only.
 */
export function normalizeSections(raw: unknown, groupIds: readonly string[]): Section[] {
  if (!Array.isArray(raw)) return [];
  const out: Section[] = [];
  const taken = { tags: new Set<string>(), groups: new Set<string>() };
  const firstOnly = (kind: SectionKind, values: string[]): string[] => values.filter((v) => !taken[kind].has(v) && !!taken[kind].add(v));
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const name = typeof r.name === "string" ? cleanName(r.name) : "";
    if (!name) continue;
    const ids = new Set(out.map((x) => x.id));
    const id = typeof r.id === "string" && /^t\d+$/.test(r.id) && !ids.has(r.id) ? r.id : "";
    const section: Section = {
      id,
      name,
      tags: firstOnly("tags", cleanTagList(r.tags)),
      groups: firstOnly("groups", cleanTagList(r.groups).filter((g) => groupIds.includes(g))),
    };
    if (r.collapsed === true) section.collapsed = true;
    out.push(section);
  }
  // ids given last, so a repaired one never takes the id of a later valid section
  for (const s of out) if (!s.id) s.id = nextId(out.filter((x) => x.id), "t");
  return out;
}

/** Adds a section at the end. Throws on an empty name (the caller shows the message). */
export function addSection(sections: readonly Section[], name: string): { sections: Section[]; id: string } {
  const clean = cleanName(name);
  if (!clean) throw new Error("A section needs a name");
  const id = nextId(sections, "t");
  return { sections: [...sections, { id, name: clean, tags: [], groups: [] }], id };
}

export function renameSection(sections: readonly Section[], id: string, name: string): Section[] {
  const clean = cleanName(name);
  if (!clean) throw new Error("A section needs a name");
  return sections.map((s) => (s.id === id ? { ...s, name: clean } : s));
}

/** Deletes a section; its groups and tags go back to the top (nothing else is deleted). */
export function deleteSection(sections: readonly Section[], id: string): Section[] {
  return sections.filter((s) => s.id !== id);
}

export function setSectionCollapsed(sections: readonly Section[], id: string, collapsed: boolean): Section[] {
  return sections.map((s) => (s.id === id ? { ...s, collapsed } : s));
}

/** The section holding a tag or group id, if any. */
export function sectionOf(sections: readonly Section[], kind: SectionKind, value: string): Section | undefined {
  return sections.find((s) => s[kind].includes(value));
}

/** Moves a tag or group id into section `id` (at its end), out of any other; `id` null: out of every section. */
export function moveToSection(sections: readonly Section[], id: string | null, kind: SectionKind, value: string): Section[] {
  return sections.map((s) => {
    const has = s[kind].includes(value);
    if (s.id === id) return has ? s : { ...s, [kind]: [...s[kind], value] };
    return has ? { ...s, [kind]: s[kind].filter((v) => v !== value) } : s;
  });
}

/** A deleted group leaves its section. */
export function forgetGroup(sections: readonly Section[], groupId: string): Section[] {
  return moveToSection(sections, null, "groups", groupId);
}

/** Follows a vault-wide tag fix: each tag of a section that is mapped is replaced by its replacements, once each. */
export function replaceTagsInSections(sections: readonly Section[], mapping: TagMapping): Section[] {
  return sections.map((s) => (s.tags.some((x) => mapping.has(x)) ? { ...s, tags: mapTagList(s.tags, mapping) } : s));
}
