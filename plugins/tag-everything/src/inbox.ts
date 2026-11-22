// The inbox of untagged files and the auto-tag rules. Pure, no `obsidian` import (unit-tested); the view is
// inbox-pane.ts (a tab of the TagEverything explorer), the rule dialog rule-modal.ts.
//
// A rule: "a file in this folder, whose name contains one of these words, with one of these extensions, gets these
// tags". Every condition left empty matches anything, but a rule needs at least one. Rules are offered in the inbox
// (one click to accept), applied to the whole inbox at once, or, with the setting on, to each new file as it arrives.

import { foldTag } from "./taxonomy.ts";
import { dedupe, extensionTag, setNameTags, splitExtension } from "./format.ts";
import { cleanTagList, nextId } from "./groups.ts";
import { type DateFilters, datesMatch } from "./dates.ts";

export interface AutoTagRule {
  id: string;
  /** Vault folder the file must be in, at any depth ("" = anywhere). */
  folder: string;
  /** Words, one of which the file name must contain (case and accents ignored; space / comma separated; "" = any). */
  words: string;
  /** Extensions, one of which the file must have (`pdf docx`; "" = any). */
  extensions: string;
  /** Tags the rule adds. */
  tags: string[];
}

/** Space or comma separated words, folded (lower case, no accent), without a leading dot: `.PDF, docx` -> pdf docx. */
export function wordList(text: string): string[] {
  return dedupe(text.split(/[\s,;]+/).map((w) => foldTag(w.replace(/^\./, ""))).filter(Boolean));
}

/** A folder path as typed: no leading / trailing slash, `\` read as `/`. */
export function cleanFolder(text: string): string {
  return text.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

/** Is `path` inside `folder`, at any depth? Case and accents ignored, a folder is whole path segments; "" = anywhere. */
export function inFolder(path: string, folder: string): boolean {
  const f = foldTag(cleanFolder(folder));
  return !f || foldTag(path).startsWith(`${f}/`);
}

/** The conditions of a rule, shared by auto-tag rules and exclusion rules (src/exclude.ts). */
export type RuleConditions = Pick<AutoTagRule, "folder" | "words" | "extensions">;

/** True when the rule has at least one condition: a rule without any would tag every file of the vault. */
export function hasCondition(rule: RuleConditions): boolean {
  return !!(cleanFolder(rule.folder) || wordList(rule.words).length || wordList(rule.extensions).length);
}

/** Rules from whatever `data.json` holds: damaged entries, rules without a condition or without a tag dropped. */
export function normalizeRules(raw: unknown): AutoTagRule[] {
  if (!Array.isArray(raw)) return [];
  const out: AutoTagRule[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    const rule: AutoTagRule = {
      id: text(o.id) && !out.some((x) => x.id === text(o.id)) ? text(o.id) : nextId(out, "r"),
      folder: cleanFolder(text(o.folder)),
      words: text(o.words),
      extensions: text(o.extensions),
      tags: cleanTagList(o.tags),
    };
    if (rule.tags.length && hasCondition(rule)) out.push(rule);
  }
  return out;
}

/** A rule's conditions as `ruleMatches` reads them. */
interface ParsedConditions {
  any: boolean;
  /** Folded folder, "" = anywhere. */
  folder: string;
  exts: string[];
  words: string[];
}

/** Parsed once per rule object: a rule is matched against every file of the vault (Tools tab, inbox, a folder). */
const parsedRules = new WeakMap<RuleConditions, ParsedConditions>();

function parseConditions(rule: RuleConditions): ParsedConditions {
  let p = parsedRules.get(rule);
  if (!p) {
    p = { any: hasCondition(rule), folder: foldTag(cleanFolder(rule.folder)), exts: wordList(rule.extensions), words: wordList(rule.words) };
    parsedRules.set(rule, p);
  }
  return p;
}

/** What the rules read of a file's path, each part computed on first use: several rules share it. */
interface PathParts {
  ext(): string;
  folded(): string;
  /** The name without its tags and extension, folded. */
  base(): string;
}

function pathParts(path: string): PathParts {
  const name = path.slice(path.lastIndexOf("/") + 1);
  let ext: string | undefined;
  let folded: string | undefined;
  let base: string | undefined;
  return {
    ext: () => (ext ??= extensionTag(name) ?? ""),
    folded: () => (folded ??= foldTag(path)),
    base: () => {
      if (base !== undefined) return base;
      let bare = name;
      try {
        bare = setNameTags(name, []);
      } catch {
        // a name made only of tags (`[tax].pdf`): read as it is
      }
      return (base = foldTag(splitExtension(bare)[0]));
    },
  };
}

function matchesParts(rule: RuleConditions, parts: PathParts): boolean {
  const { any, folder, exts, words } = parseConditions(rule);
  if (!any) return false;
  // cheapest test first
  if (exts.length && !exts.includes(parts.ext())) return false;
  if (folder && !parts.folded().startsWith(`${folder}/`)) return false;
  return !words.length || words.some((w) => parts.base().includes(w));
}

/**
 * Does the rule apply to the file at `path`? Its name is read without its tags and extension. Rules are never
 * mutated (settings and dialogs build new ones), so their parsed conditions are cached.
 */
export function ruleMatches(rule: RuleConditions, path: string): boolean {
  return matchesParts(rule, pathParts(path));
}

/** The tags the rules add to the file at `path`, without those it already has (any case), in rule order. */
export function rulesTags(rules: readonly AutoTagRule[], path: string, has: readonly string[]): string[] {
  if (!rules.length) return [];
  const parts = pathParts(path);
  const own = new Set(has.map((t) => t.toLowerCase()));
  return dedupe(rules.filter((r) => matchesParts(r, parts)).flatMap((r) => r.tags)).filter((t) => !own.has(t.toLowerCase()));
}

/** The conditions in one line: `In Banque · name has facture or invoice · pdf`. */
export function describeConditions(rule: RuleConditions): string {
  const parts: string[] = [];
  if (cleanFolder(rule.folder)) parts.push(`In ${cleanFolder(rule.folder)}`);
  const words = wordList(rule.words);
  if (words.length) parts.push(`name has ${words.join(" or ")}`);
  const exts = wordList(rule.extensions);
  if (exts.length) parts.push(exts.join(" or "));
  return parts.join(" · ") || "No condition";
}

/** The rule in one line: `In Banque · name has facture or invoice · pdf → banque facture`. */
export function describeRule(rule: AutoTagRule): string {
  return `${describeConditions(rule)} → ${rule.tags.join(" ")}`;
}

/**
 * A new rule, or `rule` with its fields replaced, in `rules`; immutable, like groups.ts. Also for exclusion rules
 * (src/exclude.ts), whose ids start with `x` (`prefix`).
 */
export function saveRule<R extends { id: string }>(rules: readonly R[], rule: Omit<R, "id"> & { id?: string }, prefix = "r"): R[] {
  if (rule.id && rules.some((r) => r.id === rule.id)) return rules.map((r) => (r.id === rule.id ? ({ ...rule, id: r.id } as R) : r));
  return [...rules, { ...rule, id: nextId(rules, prefix) } as R];
}

export function deleteRule<R extends { id: string }>(rules: readonly R[], id: string): R[] {
  return rules.filter((r) => r.id !== id);
}

/** A file the inbox may list: its path, when it arrived in the vault and was last modified, whether it carries a stored tag. */
export interface InboxCandidate {
  path: string;
  ctime: number;
  /** Default: `ctime`. */
  mtime?: number;
  tagged: boolean;
}

/**
 * The inbox: files with no stored tag that arrived (were created in the vault) in the last `days` days, newest first,
 * without those the user dismissed; only those inside `folder` when it is set (the inbox focused on one folder).
 * `dates` (src/dates.ts), the inbox's date criteria: a `created` one replaces the last `days` days (so older files
 * can be listed), a `modified` one is checked as well.
 */
export function inboxPaths(files: readonly InboxCandidate[], now: number, days: number, dismissed: ReadonlySet<string>, folder = "", dates: DateFilters = {}): string[] {
  const window: DateFilters = { created: dates.created ?? { within: true, days }, modified: dates.modified };
  const folded = foldTag(cleanFolder(folder)); // `inFolder`, the folder folded once
  const inside = (path: string): boolean => !folded || foldTag(path).startsWith(`${folded}/`);
  return files
    .filter((f) => !f.tagged && !dismissed.has(f.path) && inside(f.path) && datesMatch(window, { ctime: f.ctime, mtime: f.mtime ?? f.ctime }, now))
    .sort((a, b) => b.ctime - a.ctime || a.path.localeCompare(b.path))
    .map((f) => f.path);
}

/** How long ago, short: `just now`, `5 min`, `3 h`, `2 d`. */
export function ageText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}
