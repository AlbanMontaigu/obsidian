// Files and folders excluded from TagEverything. Pure, no `obsidian` import (unit-tested under node --test).
//
// An excluded item is ignored everywhere: not indexed (no badge, not in the panel, the explorer, query blocks or
// counts), not in the inbox, never auto-tagged, suggested for or written to. The tags it carries on disk stay as they
// are and come back when it is included again. Three ways to exclude: paths, by hand (right-click; a folder takes
// everything under it), names (settings: folder names, file names and extensions, e.g. `__pycache__`, `.*`, `tmp`;
// defaults below), and exclusion rules, with the conditions of the auto-tag rules (src/inbox.ts).

import { type RuleConditions, cleanFolder, hasCondition, inFolder, ruleMatches, wordList } from "./inbox.ts";
import { foldTag } from "./taxonomy.ts";
import { cleanTagList, nextId } from "./groups.ts";

export interface ExcludeRule extends RuleConditions {
  /** "x1", "x2"... */
  id: string;
}

/**
 * Why an item is excluded: a path excluded by hand (the item or a folder above it), a name of the settings (a folder
 * of its path, or its extension), or a rule.
 */
export type Exclusion =
  | { by: "path"; path: string }
  | { by: "name"; kind: NameKind; pattern: string }
  | { by: "rule"; rule: ExcludeRule };

export type NameKind = "folder" | "file" | "extension";

/** Folder names excluded by default: dot-folders (`.vscode`, `.git`, `.venv`), scratch, Python and Node caches. */
export const DEFAULT_EXCLUDED_FOLDERS = ".*, tmp, temp, __pycache__, node_modules, venv";
/** File names excluded by default: dot-files (`.gitignore`), Office lock files, Windows folder caches. */
export const DEFAULT_EXCLUDED_FILES = ".*, ~$*, Thumbs.db, desktop.ini";
/** File extensions excluded by default: temporary, backup, editor swap, compiled Python, partial downloads. */
export const DEFAULT_EXCLUDED_EXTENSIONS = "tmp, temp, bak, swp, pyc, pyo, crdownload, part";

interface NamePattern {
  /** As typed, for messages. */
  text: string;
  re: RegExp;
}

/** The names of the settings, parsed once (`parseNames`). */
export interface ExcludedNames {
  folders: NamePattern[];
  files: NamePattern[];
  extensions: NamePattern[];
}

export const NO_NAMES: ExcludedNames = { folders: [], files: [], extensions: [] };

/** `*` any characters, `?` one; the rest literal; matched on folded text (case and accents ignored). */
function globSource(pattern: string): string {
  return [...foldTag(pattern)].map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&"))).join("");
}

/** Comma or line separated entries, trimmed, once each. */
function entries(text: string): string[] {
  return [...new Set(text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean))];
}

const whole = (text: string): NamePattern => ({ text, re: new RegExp(`^${globSource(text)}$`) });

/**
 * The settings' folder names and file names (comma separated, a name may hold spaces; `*` / `?` wildcards: `.*` =
 * every name starting with a dot) and extensions (comma or space separated, `.tmp` / `*.tmp` read as `tmp`, `tar.gz`
 * allowed).
 */
export function parseNames(folders: string, files: string, extensions: string): ExcludedNames {
  return {
    folders: entries(folders).map(whole),
    files: entries(files).map(whole),
    extensions: entries(extensions.replace(/\s+/g, ","))
      .map((e) => e.replace(/^\*?\.+/, ""))
      .filter(Boolean)
      .map((text) => ({ text, re: new RegExp(`.\\.${globSource(text)}$`) })),
  };
}

/**
 * Is the item excluded by a name of the settings? A folder of its path (a folder: itself too) matching a folder name;
 * for a file, its whole name matching a file name, or ending with an excluded extension (a tag group before it does
 * not matter). Case and accents ignored.
 */
export function nameExclusion(path: string, isFolder: boolean, names: ExcludedNames): Exclusion | null {
  if (!names.folders.length && !names.files.length && !names.extensions.length) return null;
  const parts = foldTag(path).split("/");
  const name = isFolder ? "" : (parts.pop() ?? "");
  for (const part of parts) {
    const hit = names.folders.find((p) => p.re.test(part));
    if (hit) return { by: "name", kind: "folder", pattern: hit.text };
  }
  if (!name) return null;
  const file = names.files.find((p) => p.re.test(name));
  if (file) return { by: "name", kind: "file", pattern: file.text };
  const ext = names.extensions.find((p) => p.re.test(name));
  return ext ? { by: "name", kind: "extension", pattern: ext.text } : null;
}

const KIND_LABEL: Record<NameKind, string> = { folder: "folder name", file: "file name", extension: "extension" };

/** The exclusion in a few words, for tooltips and menus: `the folder name "tmp"`, `the extension "bak"`. */
export function describeNameExclusion(why: Extract<Exclusion, { by: "name" }>): string {
  return `the ${KIND_LABEL[why.kind]} "${why.pattern}"`;
}

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

/** Why the item at `path` is excluded, or null: a path excluded by hand first, then a name, then the first rule covering it. */
export function exclusionOf(
  path: string,
  isFolder: boolean,
  paths: readonly string[],
  rules: readonly ExcludeRule[],
  names: ExcludedNames = NO_NAMES,
): Exclusion | null {
  const excluded = paths.find((p) => under(path, p));
  if (excluded) return { by: "path", path: excluded };
  const byName = nameExclusion(path, isFolder, names);
  if (byName) return byName;
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
