// Files and folders excluded from TagEverything. Pure, no `obsidian` import (unit-tested under node --test).
//
// An excluded item is ignored everywhere: not indexed (no badge, not in the panel, the explorer, query blocks or
// counts), not in the inbox, never auto-tagged, suggested for or written to. The tags it carries on disk stay as they
// are and come back when it is included again. Two ways to exclude: paths, by hand (right-click; a folder takes
// everything under it), and exclusion rules, with the conditions of the auto-tag rules (src/inbox.ts).

import { type RuleConditions, cleanFolder, hasCondition, inFolder, ruleMatches, wordList } from "./inbox.ts";
import { foldTag } from "./taxonomy.ts";
import { cleanTagList, nextId } from "./groups.ts";

export interface ExcludeRule extends RuleConditions {
  /** "x1", "x2"... */
  id: string;
}

/** Why an item is excluded: a path excluded by hand (the item or a folder above it), or a rule. */
export type Exclusion = { by: "path"; path: string } | { by: "rule"; rule: ExcludeRule };

/** Excluded paths from `data.json`: strings only, no leading / trailing slash, once each. */
export function normalizeExcludedPaths(raw: unknown): string[] {
  return [...new Set(cleanTagList(raw).map(cleanFolder).filter(Boolean))];
}

/** Exclusion rules from `data.json`: damaged entries and rules without a condition dropped (one would exclude all). */
export function normalizeExcludeRules(raw: unknown): ExcludeRule[] {
  if (!Array.isArray(raw)) return [];
  const out: ExcludeRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    const id = text(o.id);
    const rule: ExcludeRule = {
      id: /^x\d+$/.test(id) && !out.some((x) => x.id === id) ? id : "",
      folder: cleanFolder(text(o.folder)),
      words: text(o.words),
      extensions: text(o.extensions),
    };
    if (hasCondition(rule)) out.push(rule);
  }
  // ids given last, so a repaired one never takes the id of a later valid rule
  for (const rule of out) if (!rule.id) rule.id = nextId(out.filter((x) => x.id), "x");
  return out;
}

/** `path` is `excluded` or inside it (vault paths are exact: no case folding). */
function under(path: string, excluded: string): boolean {
  return path === excluded || path.startsWith(`${excluded}/`);
}

/**
 * Does the exclusion rule cover the item? A file: when it matches the rule (src/inbox.ts `ruleMatches`). A folder:
 * only through a rule with a folder alone, for that folder and the folders inside it (words and extensions are
 * about file names).
 */
export function excludeRuleMatches(rule: RuleConditions, path: string, isFolder: boolean): boolean {
  if (!isFolder) return ruleMatches(rule, path);
  const folder = cleanFolder(rule.folder);
  if (!folder || wordList(rule.words).length || wordList(rule.extensions).length) return false;
  return foldTag(path) === foldTag(folder) || inFolder(path, folder);
}

/** Why the item at `path` is excluded, or null: a path excluded by hand first, then the first rule covering it. */
export function exclusionOf(path: string, isFolder: boolean, paths: readonly string[], rules: readonly ExcludeRule[]): Exclusion | null {
  const excluded = paths.find((p) => under(path, p));
  if (excluded) return { by: "path", path: excluded };
  const rule = rules.find((r) => excludeRuleMatches(r, path, isFolder));
  return rule ? { by: "rule", rule } : null;
}

/** Excludes (`on`) or includes again a path. Excluding a folder drops the paths under it: it covers them now. */
export function setExcluded(paths: readonly string[], path: string, on: boolean): string[] {
  if (!on) return paths.filter((p) => p !== path);
  return [...paths.filter((p) => !under(p, path)), path];
}

/** An excluded path stays excluded when it (or a folder above it) is renamed or moved. */
export function renameExcluded(paths: readonly string[], oldPath: string, newPath: string): string[] {
  return paths.map((p) => (under(p, oldPath) ? newPath + p.slice(oldPath.length) : p));
}
